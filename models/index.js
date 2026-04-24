const mongoose = require('mongoose');

const carSchema = new mongoose.Schema({
  name: { type: String, required: true },
  model: { type: String, required: true },
  image: { type: String, default: '/images/default-crysta.jpeg' }, // URL path or data URI
  imageData: { type: String },   // base64 data URI — stored in MongoDB, works on all servers
  pricePerKm: { type: Number, required: true },
  fixedPackage: { km: Number, price: Number },
  extraKmCharge: { type: Number, required: true },
  tollTax: { type: String, default: 'As per actual' },
  availableIn: [String],
  seats: { type: Number, default: 7 },
  ac: { type: Boolean, default: true },
  description: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
  bookingId: { type: String, unique: true, required: true },
  car: { type: mongoose.Schema.Types.ObjectId, ref: 'Car' },
  carName: String,
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  customerEmail: { type: String, required: true },
  pickupLocation: { type: String, required: true },
  dropLocation: { type: String, required: true },
  journeyDate: { type: Date, required: true },
  journeyTime: String,
  estimatedKm: { type: Number, required: true, min: 1 },
  totalPrice: Number,
  status: { type: String, enum: ['pending','confirmed','completed','cancelled'], default: 'pending' },
  advancePaid: { type: Boolean, default: false },
  advanceConfirmedByAdmin: { type: Boolean, default: false },
  actualKm: Number,
  tollAmount: Number,
  finalFare: Number,
  balanceDue: Number,
  cancelledBy: String,
  paymentReceivedByAdmin: { type: Boolean, default: false },
  paymentReceivedAt: Date,
  cancelledAt: Date,
  penaltyAmount: Number,
  refundAmount: Number,
  driverArrivalTime: Date,
  assignedPartner: { type: mongoose.Schema.Types.ObjectId, ref: 'CarPartner', default: null },
  assignedPartnerName: String,
  driverLat: Number, driverLng: Number, driverLastSeen: Date,
  notes: String,
  createdAt: { type: Date, default: Date.now }
});

const subscriptionSchema = new mongoose.Schema({
  endpoint: { type: String, unique: true },
  keys: { p256dh: String, auth: String },
  role: { type: String, enum: ['admin','customer'], default: 'customer' },
  phone: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const chatMessageSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  message: { type: String, required: true },
  fromCustomer: { type: Boolean, default: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const testimonialSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  message: { type: String, required: true, maxlength: 500 },
  approved: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const carPartnerSchema = new mongoose.Schema({
  ownerName: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, required: true },
  carName: { type: String, required: true },
  carModel: { type: String, required: true },
  carNumber: { type: String, required: true },
  seats: { type: Number, default: 7 },
  ac: { type: Boolean, default: true },
  pricePerKm: { type: Number, required: true },
  fixedKm: Number,
  fixedPrice: Number,
  extraKmCharge: { type: Number, required: true },
  licensePhoto: String, rcPhoto: String, insurancePhoto: String,
  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  commissionPct: { type: Number, default: 10 },
  driverSecret: String,
  resetOtp: String, resetOtpExpiry: Date,
  createdAt: { type: Date, default: Date.now }
});

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  name: String,
  otp: { type: String, required: true },
  expiry: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Car = mongoose.model('Car', carSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const PushSubscription = mongoose.model('PushSubscription', subscriptionSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
const Testimonial = mongoose.model('Testimonial', testimonialSchema);
const CarPartner = mongoose.model('CarPartner', carPartnerSchema);
const OtpRecord = mongoose.model('OtpRecord', otpSchema);

module.exports = { Car, Booking, PushSubscription, ChatMessage, Testimonial, CarPartner, OtpRecord };
