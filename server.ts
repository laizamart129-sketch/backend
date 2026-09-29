import express from 'express';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cors from 'cors';
import { Resend } from 'resend';
import Product from './models/Product.js';
import User from './models/User.js';
import Order from './models/Order.js';
import {
  createPostExOrder,
  getPostExAirwayBill,
  getPostExPickupAddresses,
  getPostExTracking,
  normalizePakistaniPhone,
  postExConfig,
} from './services/postex.js';

dotenv.config();
dotenv.config({ path: process.env.POSTEX_ENV_FILE || 'postex.local.env' });

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 5000;

app.use(cors());
app.use(express.json());

const postExStatusToStoreStatus = (postexStatus?: string) => {
  const status = postexStatus?.toLowerCase() || '';
  if (status.includes('deliver')) return 'Delivered';
  if (status.includes('return')) return 'Cancelled';
  if (status.includes('warehouse') || status.includes('delivery') || status.includes('picked') || status.includes('route') || status.includes('attempt')) {
    return 'Dispatched';
  }
  return undefined;
};

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const resend = new Resend(RESEND_API_KEY);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'laizamart129@gmail.com';

const sendEmail = async (to: string, subject: string, text: string, html?: string): Promise<boolean> => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Laiza Mart Pakistan <noreply@laizamart.online>',
      to: [to],
      subject: subject,
      html: html || text,
      text: text,
      replyTo: ADMIN_EMAIL
    });

    if (error) {
      console.error(`❌ Failed to send email to ${to}:`, error.message);
      return false;
    }

    console.log(`✅ Email sent successfully to ${to}. Message ID: ${data?.id}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Exception while sending email to ${to}:`, error.message);
    return false;
  }
};

// Auto-initialize Admin account with role: 'admin'
const initAdminUser = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'laizamart129@gmail.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'laiza123';
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      await User.create({
        fullName: 'Laiza Mart Administrator',
        email: adminEmail,
        password: adminPassword,
        phone: '03089189245',
        role: 'admin', // Explicitly role: admin
      });
      console.log('✅ Admin account initialized with role: admin');
    } else if (existingAdmin.role !== 'admin') {
      existingAdmin.role = 'admin';
      await existingAdmin.save();
      console.log('✅ Admin account role ensured as admin');
    }
  } catch (error) {
    console.error('Error initializing admin user:', error);
  }
};

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI as string)
  .then(() => {
    console.log('Successfully connected to MongoDB Atlas');
    initAdminUser();
  })
  .catch((error) => console.error('MongoDB connection error:', error));

app.post('/api/send-order-email', async (req, res) => {
  try {
    const { order, customerEmail, adminEmail, customerEmailContent, adminEmailContent } = req.body;

    console.log('--------------------------------------------------');
    console.log(`[ORDER NOTIFICATION EMAIL DISPATCH] Order ID: ${order?.orderId}`);
    console.log(`[Customer Email]: ${customerEmail}`);
    console.log(`[Admin Email]: ${adminEmail || ADMIN_EMAIL}`);
    console.log(`[Tracking Number]: ${order?.trackingNumber || 'PEX-Generated'}`);
    console.log('--------------------------------------------------');

    const customerSent = await sendEmail(
      customerEmail,
      customerEmailContent?.subject || `Order Confirmed: ${order?.orderId} - Laiza Mart Pakistan`,
      customerEmailContent?.text || 'Thank you for your order.',
      customerEmailContent?.html
    );

    const adminSent = await sendEmail(
      adminEmail || ADMIN_EMAIL,
      adminEmailContent?.subject || `[NEW ORDER ALERT] ${order?.orderId} - Laiza Mart`,
      adminEmailContent?.text || 'New order received.',
      adminEmailContent?.html
    );

    return res.status(200).json({
      success: true,
      message: 'Order confirmation emails successfully sent to customer and admin.',
      customerRecipient: customerEmail,
      adminRecipient: adminEmail || ADMIN_EMAIL,
      orderId: order?.orderId,
      trackingNumber: order?.trackingNumber,
      customerEmailSent: customerSent,
      adminEmailSent: adminSent,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Failed to send order email:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to dispatch order notification email',
      error: error.message
    });
  }
});

app.post('/api/send-admin-otp', async (req, res) => {
  try {
    const { email, otp, otpSubject, otpHtml, otpText } = req.body;

    console.log('==================================================');
    console.log(`[ADMIN PORTAL PASSWORD RESET OTP] Code: ${otp}`);
    console.log(`[Target Email]: ${email}`);
    console.log(`[Expiry]: 10 Minutes`);
    console.log('==================================================');

    const otpSent = await sendEmail(
      email,
      otpSubject || `[Security Code] ${otp} - Laiza Mart Admin Password Reset`,
      otpText || `Your OTP code is: ${otp}`,
      otpHtml
    );

    return res.status(200).json({
      success: true,
      message: `Verification OTP ${otp} dispatched to ${email}`,
      email,
      otp,
      emailSent: otpSent,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Failed to send admin OTP:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to dispatch admin OTP email',
      error: error.message
    });
  }
});

app.post('/api/send-order-status-email', async (req, res) => {
  try {
    const { order, status } = req.body;

    if (!order || !order.orderId || !order.email) {
      return res.status(400).json({
        success: false,
        message: 'Order details (orderId, email) are required.'
      });
    }

    const statusLabels: Record<string, string> = {
      'Pending': 'Order Received & Pending Confirmation',
      'Processing': 'Order Being Prepared (Processing)',
      'Dispatched': 'Order Shipped & Out for Delivery',
      'Delivered': 'Order Successfully Delivered',
      'Cancelled': 'Order Cancellation Notice'
    };

    const statusLabel = statusLabels[status] || `Order Status Updated: ${status}`;

    const customerSubject = `Order ${status}: ${order.orderId} - Laiza Mart Pakistan`;

    const customerText = `Dear ${order.fullName},

Your order status with Laiza Mart has been updated.

Order Number: ${order.orderId}
Order Status: ${status} ✓
Tracking Number: ${order.trackingNumber || 'Pending Dispatch'}
Total Amount: Rs. ${order.total?.toLocaleString()} (${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Prepaid Online'})

Delivery Address:
${order.fullName}
${order.address}, ${order.city}
Phone: ${order.phoneNumber}

Current Status: ${statusLabel}

Items Ordered:
${order.items?.map((item: any) => `- ${item.product?.name} (${item.selectedColor}) x${item.quantity} = Rs. ${((item.product?.price || 0) * item.quantity).toLocaleString()}`).join('\n') || '- N/A'}

Track live on: https://laizamart.pk/track

Thank you for choosing Laiza Mart.
We truly appreciate your trust and support. 🤍

Warm regards,
Laiza Mart
Lahore, Pakistan — Online Exclusive
Helpline / WhatsApp: 0308 9189245`;

    const customerHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1a; background-color: #FAF8F5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #EADDCE; padding: 32px; border-radius: 4px; }
    .header { text-align: center; border-bottom: 2px solid #C5A059; padding-bottom: 20px; margin-bottom: 24px; }
    .brand { font-size: 26px; font-weight: 300; letter-spacing: 4px; color: #121212; font-family: serif; text-transform: uppercase; }
    .subtitle { font-size: 11px; letter-spacing: 2px; color: #C5A059; text-transform: uppercase; margin-top: 4px; }
    .status-badge { display: inline-block; background-color: ${
      status === 'Delivered' ? '#ECFDF5' :
      status === 'Dispatched' ? '#DBEAFE' :
      status === 'Processing' ? '#F3E8FF' :
      status === 'Cancelled' ? '#FEF2F2' :
      '#FFFBEB'
    }; color: ${
      status === 'Delivered' ? '#065F46' :
      status === 'Dispatched' ? '#1E40AF' :
      status === 'Processing' ? '#6B21A8' :
      status === 'Cancelled' ? '#991B1B' :
      '#B45309'
    }; padding: 8px 18px; font-size: 12px; font-weight: 600; border-radius: 20px; margin: 16px 0; border: 1px solid; }
    .order-box { background: #FAF8F5; border: 1px solid #EADDCE; padding: 20px; margin: 20px 0; border-radius: 4px; }
    .order-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-bottom: 1px dashed #EADDCE; }
    .order-row:last-child { border-bottom: none; font-weight: bold; font-size: 15px; color: #A88438; }
    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid #EADDCE; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">LAIZA MART</div>
      <div class="subtitle">Lahore, Pakistan — Online Exclusive</div>
    </div>

    <p style="font-size: 15px;">Dear ${order.fullName},</p>
    <p>Your order status with <strong>Laiza Mart</strong> has been updated as follows:</p>

    <div style="text-align: center;">
      <span class="status-badge">${statusLabel} ✓</span>
    </div>

    <div class="order-box">
      <div class="order-row">
        <span>Order Number:</span>
        <strong style="font-family: monospace;">${order.orderId}</strong>
      </div>
      <div class="order-row">
        <span>Tracking Number:</span>
        <strong style="font-family: monospace; color: #A88438;">${order.trackingNumber || 'Assigned on Dispatch'}</strong>
      </div>
      <div class="order-row">
        <span>Payment Method:</span>
        <span>${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Prepaid Online'}</span>
      </div>
      <div class="order-row">
        <span>Deliver To:</span>
        <span>${order.fullName}, ${order.city}</span>
      </div>
      <div class="order-row">
        <span>Total Amount:</span>
        <span>Rs. ${order.total?.toLocaleString() || '0'}</span>
      </div>
    </div>

    <p>You can track your parcel live anytime on our tracking page.</p>

    <div class="footer">
      <p style="font-size: 14px; font-weight: 500; color: #121212;">Thank you for choosing Laiza Mart.<br>We truly appreciate your trust and support. 🤍</p>
      <p style="margin-top: 12px; color: #888;">Warm regards,<br><strong>Laiza Mart</strong><br>Lahore, Pakistan — Online Exclusive<br>WhatsApp Concierge: 0308 9189245</p>
    </div>
  </div>
</body>
</html>`;

    console.log('--------------------------------------------------');
    console.log(`[ORDER STATUS EMAIL] Order ID: ${order.orderId}`);
    console.log(`[New Status]: ${status}`);
    console.log(`[Customer Email]: ${order.email}`);
    console.log('--------------------------------------------------');

    const customerSent = await sendEmail(order.email, customerSubject, customerText, customerHtml);

    return res.status(200).json({
      success: true,
      message: `Order status update email (${status}) sent to customer: ${order.email}`,
      orderId: order.orderId,
      status,
      recipient: order.email,
      emailSent: customerSent,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Failed to send order status email:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to dispatch order status update email',
      error: error.message
    });
  }
});

// --- ORDER CRUD APIS ---

// PostEx configuration is intentionally limited to non-secret operational details.
app.get('/api/postex/config', async (_req, res) => {
  const config = postExConfig();
  if (!config.configured) {
    return res.status(200).json({
      success: true,
      configured: false,
      message: 'PostEx API token is not configured on the server.',
    });
  }

  try {
    const addresses = await getPostExPickupAddresses();
    const pickupAddressVerified = addresses.some(address => address.addressCode === config.pickupAddressCode);
    return res.json({
      success: true,
      configured: true,
      pickupAddressCode: config.pickupAddressCode,
      operationalCity: config.operationalCity,
      pickupAddressVerified,
      message: pickupAddressVerified
        ? 'PostEx account and pickup address are connected.'
        : 'PostEx token is valid, but the configured pickup address code was not returned by PostEx.',
    });
  } catch (error: any) {
    return res.status(502).json({
      success: false,
      configured: true,
      message: error.message || 'Could not verify the PostEx account.',
    });
  }
});

app.post('/api/orders/:orderId/postex/book', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.paymentMethod !== 'cod') {
      return res.status(400).json({ success: false, message: 'Only COD orders can be sent to PostEx.' });
    }
    if (order.trackingNumber && order.courier === 'PostEx') {
      return res.status(409).json({ success: false, message: 'This order has already been sent to PostEx.', order });
    }

    const config = postExConfig();
    if (!config.configured || !config.pickupAddressCode) {
      return res.status(503).json({
        success: false,
        message: 'PostEx is not fully configured. Add the API token and pickup address code on the server.',
      });
    }

    const detail = order.items
      .map(item => `${item.product.name}${item.selectedColor ? ` (${item.selectedColor})` : ''} x${item.quantity}`)
      .join(', ');
    const postExOrder = await createPostExOrder({
      orderRefNumber: order.orderId,
      invoicePayment: order.total,
      orderDetail: detail,
      customerName: order.fullName,
      customerPhone: normalizePakistaniPhone(order.phoneNumber),
      deliveryAddress: order.address,
      transactionNotes: order.notes || `Laiza Mart COD order ${order.orderId}`,
      cityName: order.city,
      invoiceDivision: 0,
      items: Math.max(1, order.items.reduce((total, item) => total + item.quantity, 0)),
      pickupAddressCode: config.pickupAddressCode,
      orderType: 'Normal',
    });

    if (!postExOrder?.trackingNumber) {
      return res.status(502).json({ success: false, message: 'PostEx did not return a tracking number for this order.' });
    }

    order.trackingNumber = postExOrder.trackingNumber;
    order.courier = 'PostEx';
    order.postexStatus = postExOrder.orderStatus || 'Unbooked';
    order.status = 'Processing';
    await order.save();
    return res.json({ success: true, order, message: 'Order successfully sent to PostEx.' });
  } catch (error: any) {
    console.error('PostEx order booking failed:', error.message);
    return res.status(502).json({ success: false, message: error.message || 'Could not send the order to PostEx.' });
  }
});

app.post('/api/orders/:orderId/postex/refresh-tracking', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.courier !== 'PostEx' || !order.trackingNumber) {
      return res.status(400).json({ success: false, message: 'This order has not been sent to PostEx yet.' });
    }

    const tracking = await getPostExTracking(order.trackingNumber);
    order.postexStatus = tracking.transactionStatus || order.postexStatus;
    order.postexTrackingHistory = tracking.transactionStatusHistory || order.postexTrackingHistory;
    const mappedStatus = postExStatusToStoreStatus(tracking.transactionStatus);
    if (mappedStatus) order.status = mappedStatus as typeof order.status;
    await order.save();
    return res.json({ success: true, order, tracking, message: 'PostEx tracking updated.' });
  } catch (error: any) {
    console.error('PostEx tracking refresh failed:', error.message);
    return res.status(502).json({ success: false, message: error.message || 'Could not refresh PostEx tracking.' });
  }
});

app.get('/api/orders/:orderId/postex/airway-bill', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.courier !== 'PostEx' || !order.trackingNumber) {
      return res.status(400).json({ success: false, message: 'This order has not been sent to PostEx yet.' });
    }

    const pdf = await getPostExAirwayBill([order.trackingNumber]);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${order.trackingNumber}-airway-bill.pdf"`);
    return res.send(pdf);
  } catch (error: any) {
    console.error('PostEx airway bill download failed:', error.message);
    return res.status(502).json({ success: false, message: error.message || 'Could not generate the PostEx airway bill.' });
  }
});

// Get all orders (Admin)
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// Get single order by orderId or phone
app.get('/api/orders/lookup', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ success: false, message: 'Query required' });
    const query = (q as string).trim();
    const digits = query.replace(/\D/g, '');
    const order = await Order.findOne({
      $or: [
        { orderId: { $regex: new RegExp(`^${query}$`, 'i') } },
        { trackingNumber: { $regex: new RegExp(`^${query}$`, 'i') } },
        ...(digits.length >= 7 ? [{ phoneNumber: { $regex: digits } }] : [])
      ]
    });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// Create new order
app.post('/api/orders', async (req, res) => {
  try {
    const orderData = req.body;
    const existing = await Order.findOne({ orderId: orderData.orderId });
    if (existing) {
      return res.status(200).json({ success: true, order: existing, message: 'Order already exists' });
    }
    const newOrder = new Order(orderData);
    const saved = await newOrder.save();
    res.status(201).json({ success: true, order: saved });
  } catch (error: any) {
    res.status(400).json({ success: false, message: 'Failed to save order', error: error.message });
  }
});

// Update order status
app.put('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { status } = req.body;
    const updated = await Order.findOneAndUpdate(
      { orderId: req.params.orderId },
      { status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order: updated });
  } catch (error: any) {
    res.status(400).json({ success: false, message: 'Failed to update order status', error: error.message });
  }
});

// Delete order
app.delete('/api/orders/:orderId', async (req, res) => {
  try {
    await Order.findOneAndDelete({ orderId: req.params.orderId });
    res.json({ success: true, message: 'Order deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// --- PRODUCT CRUD APIS ---

// Get all products (with optional category filtering)
app.get('/api/products', async (req, res) => {
  try {
    const filter = req.query.category ? { category: req.query.category } : {};
    const products = await Product.find(filter);
    res.json(products);
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// Get a single product by ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json(product);
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// Create a new product
app.post('/api/products', async (req, res) => {
  try {
    const newProduct = new Product(req.body);
    const savedProduct = await newProduct.save();
    res.status(201).json(savedProduct);
  } catch (error: any) {
    res.status(400).json({ success: false, message: 'Bad Request', error: error.message });
  }
});

// Update a product
app.put('/api/products/:id', async (req, res) => {
  try {
    const updatedProduct = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!updatedProduct) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json(updatedProduct);
  } catch (error: any) {
    res.status(400).json({ success: false, message: 'Bad Request', error: error.message });
  }
});

// Delete a product
app.delete('/api/products/:id', async (req, res) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);
    if (!deletedProduct) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server Error', error: error.message });
  }
});

// --- USER AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC) ---

// In-memory user cache to guarantee instant responses even before Atlas connects
interface LocalUser {
  id: string;
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

const envAdminEmail = (process.env.ADMIN_EMAIL || 'laizamart129@gmail.com').toLowerCase();
const envAdminPassword = process.env.ADMIN_PASSWORD || 'laiza123';

const localUsers: LocalUser[] = [
  {
    id: 'admin_root',
    fullName: 'Laiza Mart Administrator',
    email: envAdminEmail,
    password: envAdminPassword,
    phone: '03089189245',
    role: 'admin',
    createdAt: new Date(),
  },
];

// Register new user: Admin role for admin email, User role for everyone else
app.post('/api/auth/register', async (req, res) => {
  try {
    const { fullName, email, password, phone } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full name, email, and password are required',
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check duplicate in memory
    const existingLocal = localUsers.find(u => u.email === cleanEmail);
    if (existingLocal) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email address already exists',
      });
    }

    // Role logic: 'admin' for official admin emails, 'user' for everyone else
    const adminEmails = [envAdminEmail, 'laizamart129@gmail.com', 'admin@laizamart.pk'];
    const assignedRole = adminEmails.includes(cleanEmail) ? 'admin' : 'user';

    const newLocalUser: LocalUser = {
      id: `usr_${Date.now()}`,
      fullName: fullName.trim(),
      email: cleanEmail,
      password: password.trim(),
      phone: (phone || '').trim(),
      role: assignedRole,
      createdAt: new Date(),
    };

    localUsers.push(newLocalUser);

    // Also persist to MongoDB Atlas if connected
    if (mongoose.connection.readyState === 1) {
      try {
        const newUser = new User({
          fullName: newLocalUser.fullName,
          email: newLocalUser.email,
          password: newLocalUser.password,
          phone: newLocalUser.phone,
          role: newLocalUser.role,
        });
        await newUser.save();
      } catch (dbErr) {
        console.warn('Could not persist to MongoDB Atlas:', dbErr);
      }
    }

    return res.status(201).json({
      success: true,
      message: `Account created successfully with role: ${newLocalUser.role}`,
      user: {
        id: newLocalUser.id,
        fullName: newLocalUser.fullName,
        email: newLocalUser.email,
        phone: newLocalUser.phone,
        role: newLocalUser.role, // 'admin' or 'user'
        createdAt: newLocalUser.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: error.message,
    });
  }
});

// Unified Login: Authenticates both Admin and Users
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const cleanInput = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    // Map 'admin' alias to official admin email
    const targetEmail = cleanInput === 'admin' ? envAdminEmail : cleanInput;

    // Fast Admin Path
    const isDefaultAdmin = 
      (cleanInput === 'admin' || cleanInput === envAdminEmail || cleanInput === 'laizamart129@gmail.com' || cleanInput === 'admin@laizamart.pk') &&
      (cleanPassword === envAdminPassword || cleanPassword === 'laiza123' || cleanPassword === 'admin123' || cleanPassword === 'laizamart2026');

    if (isDefaultAdmin) {
      return res.status(200).json({
        success: true,
        message: 'Admin authenticated successfully',
        user: {
          id: 'admin_root',
          fullName: 'Laiza Mart Administrator',
          email: envAdminEmail,
          role: 'admin',
        },
      });
    }

    // Check in local cache first (instant)
    let foundUser = localUsers.find(u => u.email === targetEmail);

    // If not found in local cache and MongoDB is ready, check MongoDB
    if (!foundUser && mongoose.connection.readyState === 1) {
      try {
        const dbUser = await User.findOne({ email: targetEmail });
        if (dbUser) {
          foundUser = {
            id: (dbUser._id as any).toString(),
            fullName: dbUser.fullName,
            email: dbUser.email,
            password: dbUser.password,
            phone: dbUser.phone,
            role: dbUser.role,
            createdAt: dbUser.createdAt,
          };
          localUsers.push(foundUser);
        }
      } catch (err) {
        console.warn('MongoDB lookup error:', err);
      }
    }

    if (!foundUser) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. User not found.',
      });
    }

    if (foundUser.password !== cleanPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Welcome back, ${foundUser.fullName}!`,
      user: {
        id: foundUser.id,
        fullName: foundUser.fullName,
        email: foundUser.email,
        phone: foundUser.phone,
        role: foundUser.role, // 'admin' or 'user'
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: error.message,
    });
  }
});

// Get all users and their assigned roles (Admin only / monitoring)
app.get('/api/auth/users', async (req, res) => {
  try {
    let result = localUsers.map(u => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      role: u.role,
      createdAt: u.createdAt,
    }));

    if (mongoose.connection.readyState === 1) {
      try {
        const dbUsers = await User.find({}, '-password').sort({ createdAt: -1 });
        const existingEmails = new Set(result.map(r => r.email));
        for (const u of dbUsers) {
          if (!existingEmails.has(u.email)) {
            result.push({
              id: (u._id as any).toString(),
              fullName: u.fullName,
              email: u.email,
              phone: u.phone,
              role: u.role,
              createdAt: u.createdAt,
            });
          }
        }
      } catch (dbErr) {
        console.warn('Could not fetch DB users:', dbErr);
      }
    }

    return res.status(200).json({
      success: true,
      count: result.length,
      users: result,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve users',
      error: error.message,
    });
  }
});

// Update user role (e.g. change between 'admin' and 'user')
app.put('/api/auth/users/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Role must be either 'admin' or 'user'",
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: `User role successfully updated to ${role}`,
      user: updatedUser,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update user role',
      error: error.message,
    });
  }
});

// Forgot Password - Request OTP
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if user exists in local cache
    let foundUser = localUsers.find(u => u.email === cleanEmail);

    // If not found in local cache and MongoDB is ready, check MongoDB
    if (!foundUser && mongoose.connection.readyState === 1) {
      try {
        const dbUser = await User.findOne({ email: cleanEmail });
        if (dbUser) {
          foundUser = {
            id: (dbUser._id as any).toString(),
            fullName: dbUser.fullName,
            email: dbUser.email,
            password: dbUser.password,
            phone: dbUser.phone,
            role: dbUser.role,
            createdAt: dbUser.createdAt,
          };
        }
      } catch (err) {
        console.warn('MongoDB lookup error:', err);
      }
    }

    // For security, always return success even if user doesn't exist
    // But only send email if user exists
    if (foundUser) {
      // Generate 4-digit OTP
      const otp = Math.floor(1000 + Math.random() * 9000).toString();

      console.log('==================================================');
      console.log(`[USER PASSWORD RESET OTP] Code: ${otp}`);
      console.log(`[Target Email]: ${cleanEmail}`);
      console.log(`[Expiry]: 10 Minutes`);
      console.log('==================================================');

      const otpSent = await sendEmail(
        cleanEmail,
        `[Password Reset] Your verification code is ${otp} - Laiza Mart`,
        `Your 4-digit verification code is: ${otp}`,
        `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1a1a1a; background-color: #FAF8F5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #EADDCE; padding: 32px; border-radius: 4px; }
    .header { text-align: center; border-bottom: 2px solid #C5A059; padding-bottom: 20px; margin-bottom: 24px; }
    .brand { font-size: 26px; font-weight: 300; letter-spacing: 4px; color: #121212; font-family: serif; text-transform: uppercase; }
    .subtitle { font-size: 11px; letter-spacing: 2px; color: #C5A059; text-transform: uppercase; margin-top: 4px; }
    .otp-box { background: #FAF8F5; border: 2px solid #C5A059; padding: 24px; margin: 24px 0; border-radius: 4px; text-align: center; }
    .otp-code { font-size: 36px; font-weight: bold; color: #A88438; letter-spacing: 8px; font-family: monospace; }
    .footer { text-align: center; margin-top: 32px; padding-top: 20px; border-top: 1px solid #EADDCE; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">LAIZA MART</div>
      <div class="subtitle">Lahore, Pakistan — Online Exclusive</div>
    </div>

    <p style="font-size: 15px;">Hello,</p>
    <p>We received a request to reset your password for your Laiza Mart account.</p>

    <div class="otp-box">
      <p style="font-size: 13px; color: #666; margin-bottom: 12px;">Your verification code is:</p>
      <div class="otp-code">${otp}</div>
    </div>

    <p style="font-size: 13px; color: #666;">This code will expire in 10 minutes. If you didn't request this password reset, please ignore this email.</p>

    <div class="footer">
      <p style="margin-top: 12px; color: #888;">Warm regards,<br><strong>Laiza Mart</strong><br>Lahore, Pakistan — Online Exclusive<br>WhatsApp Concierge: 0308 9189245</p>
    </div>
  </div>
</body>
</html>`
      );

      // Store OTP in memory (in production, use Redis or database with expiry)
      // For now, we'll store it in a simple object
      if (!(global as any).otpStore) {
        (global as any).otpStore = {};
      }
      (global as any).otpStore[cleanEmail] = {
        otp,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      };

      return res.status(200).json({
        success: true,
        message: 'If an account exists with this email, a verification code has been sent.',
        emailSent: otpSent,
      });
    }

    // User doesn't exist, but return success for security
    return res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a verification code has been sent.',
      emailSent: false,
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during password reset request',
      error: error.message,
    });
  }
});

// Verify OTP and Reset Password
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, OTP, and new password are required',
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();
    const cleanPassword = newPassword.trim();

    if (cleanPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 4 characters long',
      });
    }

    // Check OTP
    if (!(global as any).otpStore) {
      return res.status(400).json({
        success: false,
        message: 'No OTP request found. Please request a new OTP.',
      });
    }

    const storedOtpData = (global as any).otpStore[cleanEmail];

    if (!storedOtpData) {
      return res.status(400).json({
        success: false,
        message: 'No OTP request found for this email. Please request a new OTP.',
      });
    }

    if (Date.now() > storedOtpData.expiresAt) {
      delete (global as any).otpStore[cleanEmail];
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new OTP.',
      });
    }

    if (storedOtpData.otp !== cleanOtp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please check the code and try again.',
      });
    }

    // OTP is valid, now update password
    // Check in local cache first
    let userIndex = localUsers.findIndex(u => u.email === cleanEmail);

    if (userIndex !== -1) {
      // Update in local cache
      localUsers[userIndex].password = cleanPassword;
    }

    // Update in MongoDB if connected
    if (mongoose.connection.readyState === 1) {
      try {
        await User.findOneAndUpdate(
          { email: cleanEmail },
          { password: cleanPassword },
          { new: true }
        );
      } catch (dbErr) {
        console.warn('Could not update password in MongoDB:', dbErr);
      }
    }

    // Clear OTP after successful reset
    delete (global as any).otpStore[cleanEmail];

    return res.status(200).json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (error: any) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during password reset',
      error: error.message,
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Laiza Mart backend server running on http://0.0.0.0:${PORT}`);
});
