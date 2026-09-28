import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderItem {
  product: {
    id: string;
    name: string;
    price: number;
    images: string[];
    category: string;
  };
  quantity: number;
  selectedColor: string;
  selectedSize?: string;
}

export interface IOrder extends Document {
  orderId: string;
  fullName: string;
  phoneNumber: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  paymentMethod: 'cod' | 'online';
  items: IOrderItem[];
  subtotal: number;
  deliveryCharge: number;
  discount: number;
  total: number;
  orderDate: string;
  estimatedDelivery: string;
  courier: string;
  trackingNumber?: string;
  status: 'Pending' | 'Processing' | 'Dispatched' | 'Delivered' | 'Cancelled';
  notes?: string;
  createdAt: Date;
}

const OrderItemSchema = new Schema({
  product: {
    id: String,
    name: String,
    price: Number,
    images: [String],
    category: String,
  },
  quantity: { type: Number, required: true },
  selectedColor: { type: String },
  selectedSize: { type: String },
});

const OrderSchema: Schema = new Schema({
  orderId: { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email: { type: String },
  address: { type: String, required: true },
  city: { type: String, required: true },
  postalCode: { type: String },
  paymentMethod: { type: String, enum: ['cod', 'online'], default: 'cod' },
  items: [OrderItemSchema],
  subtotal: { type: Number, required: true },
  deliveryCharge: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  orderDate: { type: String },
  estimatedDelivery: { type: String },
  courier: { type: String, default: 'Standard Courier' },
  trackingNumber: { type: String },
  status: { 
    type: String, 
    enum: ['Pending', 'Processing', 'Dispatched', 'Delivered', 'Cancelled'], 
    default: 'Pending' 
  },
  notes: { type: String },
}, {
  timestamps: true
});

OrderSchema.index({ orderId: 1 });
OrderSchema.index({ phoneNumber: 1 });
OrderSchema.index({ status: 1 });

export default mongoose.model<IOrder>('Order', OrderSchema);
