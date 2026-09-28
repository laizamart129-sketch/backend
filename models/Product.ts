import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  category: string;
  subcategory: string;
  price: number;
  originalPrice?: number;
  rating: number;
  reviewCount: number;
  isNewItem?: boolean;
  isBestSeller?: boolean;
  isGiftPick?: boolean;
  images: string[];
  colors: { name: string; hex: string }[];
  sizes?: string[];
  description: string;
  material: string;
  dimensions: string;
  careInstructions: string;
  inStock: boolean;
  giftCategory?: string[];
}

const ProductSchema: Schema = new Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  subcategory: { type: String, required: true },
  price: { type: Number, required: true },
  originalPrice: { type: Number },
  rating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
  isNewItem: { type: Boolean, default: false },
  isBestSeller: { type: Boolean, default: false },
  isGiftPick: { type: Boolean, default: false },
  images: { type: [String], required: true },
  colors: [{
    name: { type: String },
    hex: { type: String }
  }],
  sizes: { type: [String] },
  description: { type: String, required: true },
  material: { type: String, required: true },
  dimensions: { type: String, required: true },
  careInstructions: { type: String, required: true },
  inStock: { type: Boolean, default: true },
  giftCategory: { type: [String] }
}, {
  timestamps: true
});

// Create an index to make finding items by category faster
ProductSchema.index({ category: 1, subcategory: 1 });

export default mongoose.model<IProduct>('Product', ProductSchema);
