import mongoose, { Schema, Document } from 'mongoose';

export type UserRole = 'admin' | 'user';

export interface IUser extends Document {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email address is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [4, 'Password must be at least 4 characters long'],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: ['admin', 'user'],
      default: 'user', // Default role is always 'user', only admin accounts get 'admin'
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook: ensure admin email always gets 'admin' role, others get 'user'
UserSchema.pre<IUser>('save', function (next) {
  const adminEmails = ['laizamart129@gmail.com', 'admin@laizamart.pk'];
  if (this.email && typeof this.email === 'string' && adminEmails.includes(this.email.toLowerCase())) {
    this.role = 'admin';
  } else if (!this.role) {
    this.role = 'user';
  }
  next();
});

export default mongoose.model<IUser>('User', UserSchema);
