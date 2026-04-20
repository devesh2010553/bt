require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const webpush = require('web-push');
const connectDB = require('./config/db');
const { Car, Booking, PushSubscription, ChatMessage, Testimonial, CarPartner } = require('./models');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const fs = require('fs');

const app = express();

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:brajwasitravels.1980@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

connectDB();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'brajwasi_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Multer — separate storage for partner docs
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });
if (!fs.existsSync('public/uploads/docs')) fs.mkdirSync('public/uploads/docs', { recursive: true });

const carImgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.fieldname + path.extname(file.originalname))
});
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/docs/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.fieldname + path.extname(file.originalname))
});
const imgFilter = (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'));
const uploadCarImg = multer({ storage: carImgStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imgFilter });
const uploadDocs = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Images/PDF only'));
  }
});

// ── Helpers ──────────────────────────────────────────────────
const phoneHash = p => crypto.createHash('md5').update(p.trim()).digest('hex');

const sendPushTo = async (subs, title, body, data = {}) => {
  if (!subs || !subs.length) return;
  const payload = JSON.stringify({ title, body, ...data });
  await Promise.allSettled(subs.map(s =>
    webpush.sendNotification(s, payload).catch(async e => {
      if (e.statusCode === 410) await PushSubscription.deleteOne({ endpoint: s.endpoint });
    })
  ));
};
const pushAdmin    = async (title, body, data = {}) => sendPushTo(await PushSubscription.find({ role: 'admin' }), title, body, data);
const pushCustomer = async (phone, title, body, data = {}) => { if (!phone) return; sendPushTo(await PushSubscription.find({ role: 'customer', phone: phone.trim() }), title, body, data); };

const sendEmail = async (to, subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return console.log('⚠ Email skipped: set EMAIL_USER + EMAIL_PASS in Render env vars');
  }
  try {
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
    const info = await t.sendMail({ from: `"Brajwasi Tour & Travels" <${process.env.EMAIL_USER}>`, to, subject, html });
    console.log('✅ Email sent to', to, ':', info.messageId);
  } catch (e) { console.log('❌ Email error:', e.message); }
};

const bookingEmailHtml = (booking, car) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8ddd0">
  <div style="background:linear-gradient(135deg,#B8780A,#8A5A06);padding:22px 24px">
    <h2 style="color:#fff;margin:0;font-size:20px">🚗 New Booking – ${booking.bookingId}</h2>
    <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px">Brajwasi Tour & Travels Admin Alert</p>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr style="background:#fff8ec"><td style="padding:12px 20px;font-weight:700;border-bottom:1px solid #f0ebe3;width:38%">Booking ID</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3;color:#B8780A;font-weight:800">${booking.bookingId}</td></tr>
    <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Customer</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3;font-weight:600">${booking.customerName}</td></tr>
    <tr style="background:#fff8ec"><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Phone</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${booking.customerPhone}</td></tr>
    <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Car</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3;font-weight:600">${booking.carName}</td></tr>
    <tr style="background:#fff8ec"><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">From</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${booking.pickupLocation}</td></tr>
    <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">To</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${booking.dropLocation}</td></tr>
    <tr style="background:#fff8ec"><td style="padding:12px 20px;color:#7a6a55;font-weight:600;border-bottom:1px solid #f0ebe3">Date & Time</td><td style="padding:12px 20px;border-bottom:1px solid #f0ebe3">${new Date(booking.journeyDate).toLocaleDateString('en-IN')} at ${booking.journeyTime}</td></tr>
    <tr><td style="padding:12px 20px;color:#7a6a55;font-weight:600">Est. Fare</td><td style="padding:12px 20px;color:#1A7A3A;font-weight:800;font-size:16px">₹${(booking.totalPrice||0).toLocaleString('en-IN')}</td></tr>
  </table>
  <div style="background:#B8780A;padding:14px 24px;text-align:center">
    <p style="color:#fff;margin:0;font-size:13px;font-weight:600">Login to admin panel to confirm and assign this booking</p>
  </div>
</div>`;

// ════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ════════════════════════════════════════════════════════════
app.get('/', async (req, res) => {
  const [cars, testimonials] = await Promise.all([
    Car.find({ isActive: true }),
    Testimonial.find({ approved: true }).sort({ createdAt: -1 }).limit(9)
  ]);
  res.render('index', { cars, testimonials });
});

app.get('/vapid-public-key', (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' }));

app.post('/subscribe', async (req, res) => {
  const { endpoint, keys, role, phone } = req.body;
  await PushSubscription.findOneAndUpdate({ endpoint }, { endpoint, keys, role: role||'customer', phone: phone||'' }, { upsert: true, new: true });
  res.json({ success: true });
});

// ── Booking ──────────────────────────────────────────────────
app.post('/api/book', async (req, res) => {
  try {
    const { carId, customerName, customerPhone, customerEmail, pickupLocation, dropLocation, journeyDate, journeyTime, estimatedKm, notes } = req.body;
    const car = await Car.findById(carId);
    if (!car) return res.status(404).json({ error: 'Car not found' });
    const km = Number(estimatedKm) || 0;
    let totalPrice = 0;
    if (km > 0) {
      if (car.fixedPackage?.km && km <= car.fixedPackage.km) totalPrice = car.fixedPackage.price;
      else if (car.fixedPackage?.km) totalPrice = car.fixedPackage.price + ((km - car.fixedPackage.km) * car.extraKmCharge);
      else totalPrice = km * car.pricePerKm;
    }
    const bookingId = 'BT-' + uuidv4().split('-')[0].toUpperCase();
    const booking = await Booking.create({
      bookingId, car: carId, carName: `${car.name} ${car.model}`,
      customerName, customerPhone, customerEmail, pickupLocation, dropLocation,
      journeyDate: new Date(journeyDate), journeyTime, estimatedKm: km, totalPrice, notes,
      status: 'pending', advancePaid: false
    });
    await pushAdmin('🚗 New Booking!', `${customerName} · ${car.model} · ${pickupLocation} → ${dropLocation}`, { url: '/admin/bookings', bookingId });
    await pushCustomer(customerPhone, '🎉 Booking Received!', `Hi ${customerName}! Booking ${bookingId} received. We will confirm shortly.`, { url: '/track?bookingId=' + bookingId });
    const adminEmail = process.env.EMAIL_TO || process.env.EMAIL_USER;
    await sendEmail(adminEmail, `🚗 New Booking ${bookingId} – ${customerName}`, bookingEmailHtml(booking, car));
    res.json({ success: true, bookingId, totalPrice });
  } catch (err) { console.error('Booking error:', err); res.status(500).json({ error: 'Booking failed: ' + err.message }); }
});

// ── Testimonials (public) ────────────────────────────────────
app.post('/api/testimonials', async (req, res) => {
  const { name, phone, rating, message } = req.body;
  if (!name || !phone || !rating || !message) return res.status(400).json({ error: 'All fields required' });
  if (message.length > 500) return res.status(400).json({ error: 'Message too long (max 500 chars)' });
  await Testimonial.create({ name: name.trim(), phone: phone.trim(), rating: Math.min(5, Math.max(1, Number(rating))), message: message.trim() });
  res.json({ success: true });
});

app.get('/api/testimonials', async (req, res) => {
  const t = await Testimonial.find({ approved: true }).sort({ createdAt: -1 }).limit(9);
  res.json({ testimonials: t });
});

// ── Car Partner Registration (public) ────────────────────────
app.get('/partner', (req, res) => res.render('partner'));

app.post('/api/partner/register', uploadDocs.fields([
  { name: 'licensePhoto', maxCount: 1 },
  { name: 'rcPhoto', maxCount: 1 },
  { name: 'insurancePhoto', maxCount: 1 }
]), async (req, res) => {
  try {
    const { ownerName, phone, email, carName, carModel, carNumber, seats, ac, pricePerKm, fixedKm, fixedPrice, extraKmCharge } = req.body;
    if (!ownerName || !phone || !email || !carName || !carModel || !carNumber || !pricePerKm || !extraKmCharge)
      return res.status(400).json({ error: 'All required fields must be filled' });
    if (!req.files?.licensePhoto || !req.files?.rcPhoto || !req.files?.insurancePhoto)
      return res.status(400).json({ error: 'All three documents (licence, RC, insurance) are required' });
    const existing = await CarPartner.findOne({ $or: [{ phone }, { carNumber }] });
    if (existing) return res.status(400).json({ error: 'A partner with this phone or car number is already registered' });
    const partner = await CarPartner.create({
      ownerName: ownerName.trim(), phone: phone.trim(), email: email.trim(),
      carName: carName.trim(), carModel: carModel.trim(), carNumber: carNumber.trim().toUpperCase(),
      seats: +seats || 7, ac: ac === 'true',
      pricePerKm: +pricePerKm, extraKmCharge: +extraKmCharge,
      fixedKm: fixedKm ? +fixedKm : undefined,
      fixedPrice: fixedPrice ? +fixedPrice : undefined,
      licensePhoto: '/uploads/docs/' + req.files.licensePhoto[0].filename,
      rcPhoto: '/uploads/docs/' + req.files.rcPhoto[0].filename,
      insurancePhoto: '/uploads/docs/' + req.files.insurancePhoto[0].filename,
      status: 'pending', commissionPct: 10
    });
    // Notify admin
    await pushAdmin('🚗 New Partner Registration', `${ownerName} registered ${carName} ${carModel} (${carNumber})`, { url: '/admin' });
    await sendEmail(process.env.EMAIL_TO || process.env.EMAIL_USER,
      `New Car Partner Registration – ${ownerName}`,
      `<div style="font-family:Arial,max-width:500px"><h2 style="color:#B8780A">New Partner Registration</h2>
       <p><b>Name:</b> ${ownerName}</p><p><b>Phone:</b> ${phone}</p><p><b>Email:</b> ${email}</p>
       <p><b>Car:</b> ${carName} ${carModel} (${carNumber})</p>
       <p><b>Price/km:</b> ₹${pricePerKm} | <b>Extra/km:</b> ₹${extraKmCharge}</p>
       <p>Login to admin panel to review and approve.</p></div>`);
    res.json({ success: true, partnerId: partner._id });
  } catch (err) { console.error('Partner reg error:', err); res.status(500).json({ error: err.message }); }
});

// ── Payment ──────────────────────────────────────────────────
app.get('/api/payment/:bookingId', async (req, res) => {
  const booking = await Booking.findOne({ bookingId: req.params.bookingId });
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const upiId = process.env.UPI_ID;
  if (!upiId) return res.status(500).json({ error: 'UPI_ID not configured in environment variables' });
  const pn = encodeURIComponent('Brajwasi Tour & Travels');
  const tn = encodeURIComponent('Advance ' + booking.bookingId);
  const base = `pa=${upiId}&pn=${pn}&am=500.00&tn=${tn}&cu=INR`;
  res.json({ upiId, bookingId: booking.bookingId, upiUrl: `upi://pay?${base}`, phonepe: `phonepe://pay?${base}`, gpay: `tez://upi/pay?${base}`, paytm: `paytmmp://pay?${base}`, qrData: `upi://pay?${base}` });
});

app.post('/api/payment/:bookingId/confirm', async (req, res) => {
  await Booking.findOneAndUpdate({ bookingId: req.params.bookingId }, { advancePaid: true });
  res.json({ success: true });
});

// ── Tracking ─────────────────────────────────────────────────
app.get('/api/track', async (req, res) => {
  const { bookingId, phone } = req.query;
  let booking;
  if (bookingId) booking = await Booking.findOne({ bookingId: bookingId.trim().toUpperCase() });
  else if (phone) booking = await Booking.findOne({ customerPhone: phone.trim() }).sort({ createdAt: -1 });
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  res.json({ bookingId: booking.bookingId, customerName: booking.customerName, carName: booking.carName, pickupLocation: booking.pickupLocation, dropLocation: booking.dropLocation, journeyDate: booking.journeyDate, journeyTime: booking.journeyTime, status: booking.status, advancePaid: booking.advancePaid, totalPrice: booking.totalPrice, assignedPartnerName: booking.assignedPartnerName, driverLat: booking.driverLat, driverLng: booking.driverLng, driverLastSeen: booking.driverLastSeen });
});

app.post('/api/driver/location', async (req, res) => {
  const { bookingId, lat, lng, secret } = req.body;
  if (secret !== (process.env.DRIVER_SECRET || 'brajwasi_driver')) return res.status(403).json({ error: 'Unauthorized' });
  await Booking.findOneAndUpdate({ bookingId }, { driverLat: lat, driverLng: lng, driverLastSeen: new Date() });
  res.json({ success: true });
});

app.get('/track', (req, res) => res.render('track'));
app.get('/driver', (req, res) => res.render('driver'));

// ── Chat ─────────────────────────────────────────────────────
app.post('/api/chat/send', async (req, res) => {
  const { customerName, customerPhone, message } = req.body;
  if (!customerName || !customerPhone || !message) return res.status(400).json({ error: 'Missing fields' });
  const sessionId = phoneHash(customerPhone);
  const msg = await ChatMessage.create({ sessionId, customerName: customerName.trim(), customerPhone: customerPhone.trim(), message: message.trim(), fromCustomer: true, read: false });
  await pushAdmin(`💬 ${customerName}`, message.substring(0, 100), { url: '/admin', isChat: true, sessionId });
  res.json({ success: true, sessionId, _id: msg._id });
});
app.get('/api/chat/:phone/history', async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: phoneHash(req.params.phone) }).sort({ createdAt: 1 }).limit(200);
  res.json({ messages });
});
app.get('/api/chat/:phone/updates', async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({ sessionId: phoneHash(req.params.phone), createdAt: { $gt: since } }).sort({ createdAt: 1 });
  res.json({ messages });
});

// ════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════════
const adminAuth = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

app.get('/admin', adminAuth, async (req, res) => {
  const [cars, bookings, chatSessions, pendingPartners, testimonialsPending] = await Promise.all([
    Car.find().sort({ createdAt: -1 }),
    Booking.find().sort({ createdAt: -1 }).limit(10),
    ChatMessage.aggregate([
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$sessionId', customerName: { $first: '$customerName' }, customerPhone: { $first: '$customerPhone' }, lastMessage: { $first: '$message' }, lastTime: { $first: '$createdAt' }, totalUnread: { $sum: { $cond: { if: { $and: [{ $eq: ['$fromCustomer', true] }, { $eq: ['$read', false] }] }, then: 1, else: 0 } } } } },
      { $sort: { lastTime: -1 } }
    ]),
    CarPartner.countDocuments({ status: 'pending' }),
    Testimonial.countDocuments({ approved: false })
  ]);
  const stats = {
    totalCars: await Car.countDocuments({ isActive: true }),
    totalBookings: await Booking.countDocuments(),
    pendingBookings: await Booking.countDocuments({ status: 'pending' }),
    confirmedBookings: await Booking.countDocuments({ status: 'confirmed' }),
    pendingPartners,
    testimonialsPending
  };
  res.render('admin/dashboard', { cars, bookings, stats, chatSessions });
});

app.get('/admin/login', (req, res) => { if (req.session.admin) return res.redirect('/admin'); res.render('admin/login', { error: null }); });
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === (process.env.ADMIN_USERNAME || 'admin') && password === (process.env.ADMIN_PASSWORD || 'brajwasi@2024')) {
    req.session.admin = true; res.redirect('/admin');
  } else { res.render('admin/login', { error: 'Invalid credentials' }); }
});
app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// Cars
app.post('/admin/cars/add', adminAuth, uploadCarImg.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  await Car.create({ name, model, image: req.file ? '/uploads/' + req.file.filename : '/images/default-crysta.jpg', pricePerKm: +pricePerKm, extraKmCharge: +extraKmCharge, fixedPackage: (fixedKm && fixedPrice) ? { km: +fixedKm, price: +fixedPrice } : undefined, tollTax: tollTax || 'As per actual', availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'], seats: +seats || 7, ac: ac === 'true', description });
  res.redirect('/admin');
});
app.get('/admin/cars/:id/edit', adminAuth, async (req, res) => { const car = await Car.findById(req.params.id); if (!car) return res.redirect('/admin'); res.render('admin/edit-car', { car }); });
app.post('/admin/cars/:id/edit', adminAuth, uploadCarImg.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const upd = { name, model, pricePerKm: +pricePerKm, extraKmCharge: +extraKmCharge, fixedPackage: (fixedKm && fixedPrice) ? { km: +fixedKm, price: +fixedPrice } : { km: 0, price: 0 }, tollTax, availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'], seats: +seats || 7, ac: ac === 'true', description };
  if (req.file) upd.image = '/uploads/' + req.file.filename;
  await Car.findByIdAndUpdate(req.params.id, upd); res.redirect('/admin');
});
app.post('/admin/cars/:id/toggle', adminAuth, async (req, res) => { const car = await Car.findById(req.params.id); if (car) { car.isActive = !car.isActive; await car.save(); } res.json({ success: true, isActive: car?.isActive ?? false }); });
app.post('/admin/cars/:id/delete', adminAuth, async (req, res) => { await Car.findByIdAndDelete(req.params.id); res.redirect('/admin'); });

// Bookings
app.get('/admin/bookings', adminAuth, async (req, res) => {
  const [bookings, partners] = await Promise.all([
    Booking.find().populate('car').sort({ createdAt: -1 }),
    CarPartner.find({ status: 'approved' }).select('ownerName phone carModel carNumber')
  ]);
  res.render('admin/bookings', { bookings, partners });
});
app.post('/admin/bookings/:id/status', adminAuth, async (req, res) => {
  const booking = await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
  if (req.body.status === 'confirmed') {
    await pushCustomer(booking.customerPhone, '✅ Booking Confirmed!', `Hi ${booking.customerName}! Your booking ${booking.bookingId} is confirmed.`, { url: '/track?bookingId=' + booking.bookingId });
  } else if (req.body.status === 'cancelled') {
    await pushCustomer(booking.customerPhone, '❌ Booking Cancelled', `Your booking ${booking.bookingId} was cancelled. Call 9411061000 for help.`, { url: '/track?bookingId=' + booking.bookingId });
  }
  res.redirect('/admin/bookings');
});
app.post('/admin/bookings/:id/advance', adminAuth, async (req, res) => {
  const b = await Booking.findByIdAndUpdate(req.params.id, { advancePaid: req.body.paid === 'true' }, { new: true });
  res.json({ success: true, advancePaid: b.advancePaid });
});

// Assign booking to partner
app.post('/admin/bookings/:id/assign', adminAuth, async (req, res) => {
  const { partnerId } = req.body;
  const partner = await CarPartner.findById(partnerId);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const booking = await Booking.findByIdAndUpdate(req.params.id, { assignedPartner: partnerId, assignedPartnerName: `${partner.ownerName} (${partner.carModel} · ${partner.carNumber})` }, { new: true });
  // Email partner about the booking assignment
  const commission = Math.round((booking.totalPrice || 0) * partner.commissionPct / 100);
  const partnerEarning = (booking.totalPrice || 0) - commission;
  await sendEmail(partner.email,
    `New Booking Assigned – ${booking.bookingId}`,
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:linear-gradient(135deg,#B8780A,#8A5A06);padding:20px 24px;border-radius:12px 12px 0 0">
        <h2 style="color:#fff;margin:0;font-size:18px">🚗 Booking Assigned to You</h2>
        <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px">Brajwasi Tour & Travels</p>
      </div>
      <div style="border:1px solid #e8ddd0;border-top:none;border-radius:0 0 12px 12px;padding:0">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr style="background:#fff8ec"><td style="padding:11px 18px;font-weight:700;border-bottom:1px solid #f0ebe3">Booking ID</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3;color:#B8780A;font-weight:800">${booking.bookingId}</td></tr>
          <tr><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Customer</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3;font-weight:600">${booking.customerName} · ${booking.customerPhone}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Pickup</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3">${booking.pickupLocation}</td></tr>
          <tr><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Drop</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3">${booking.dropLocation}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Date & Time</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3">${new Date(booking.journeyDate).toLocaleDateString('en-IN')} at ${booking.journeyTime}</td></tr>
          <tr><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Total Fare</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3;font-weight:700;color:#1A7A3A">₹${(booking.totalPrice||0).toLocaleString('en-IN')}</td></tr>
          <tr style="background:#fff8ec"><td style="padding:11px 18px;color:#7a6a55;border-bottom:1px solid #f0ebe3">Commission (${partner.commissionPct}%)</td><td style="padding:11px 18px;border-bottom:1px solid #f0ebe3;color:#C0392B;font-weight:600">− ₹${commission.toLocaleString('en-IN')}</td></tr>
          <tr><td style="padding:11px 18px;color:#7a6a55;font-weight:700">Your Earning</td><td style="padding:11px 18px;color:#1A7A3A;font-weight:800;font-size:16px">₹${partnerEarning.toLocaleString('en-IN')}</td></tr>
        </table>
        <div style="padding:16px 18px;background:#fff8ec;font-size:13px;color:#7a6a55">
          <b>Note:</b> A ${partner.commissionPct}% commission of ₹${commission} is deducted by Brajwasi Tour & Travels. Your net earning is ₹${partnerEarning}.
        </div>
      </div>
    </div>`);
  res.json({ success: true, assignedPartnerName: booking.assignedPartnerName });
});

// Push notifications
app.post('/admin/push', adminAuth, async (req, res) => {
  await pushAdmin(req.body.title, req.body.body);
  res.json({ success: true });
});

// Chat admin
app.get('/admin/chat/:sessionId/messages', adminAuth, async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
  await ChatMessage.updateMany({ sessionId: req.params.sessionId, fromCustomer: true, read: false }, { $set: { read: true } });
  res.json({ messages });
});
app.post('/admin/chat/:sessionId/reply', adminAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  const existing = await ChatMessage.findOne({ sessionId: req.params.sessionId });
  if (!existing) return res.status(404).json({ error: 'Session not found' });
  await ChatMessage.create({ sessionId: req.params.sessionId, customerName: existing.customerName, customerPhone: existing.customerPhone, message: message.trim(), fromCustomer: false, read: true });
  await pushCustomer(existing.customerPhone, '💬 Brajwasi replied', message.substring(0, 100), { url: '/', isChat: true });
  res.json({ success: true });
});
app.delete('/admin/chat/:sessionId', adminAuth, async (req, res) => { await ChatMessage.deleteMany({ sessionId: req.params.sessionId }); res.json({ success: true }); });
app.get('/admin/chat/:sessionId/updates', adminAuth, async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId, createdAt: { $gt: since } }).sort({ createdAt: 1 });
  await ChatMessage.updateMany({ sessionId: req.params.sessionId, fromCustomer: true, read: false }, { $set: { read: true } });
  res.json({ messages });
});

// Testimonials admin
app.get('/admin/testimonials', adminAuth, async (req, res) => {
  const testimonials = await Testimonial.find().sort({ createdAt: -1 });
  res.render('admin/testimonials', { testimonials });
});
app.post('/admin/testimonials/:id/approve', adminAuth, async (req, res) => {
  await Testimonial.findByIdAndUpdate(req.params.id, { approved: true });
  res.json({ success: true });
});
app.post('/admin/testimonials/:id/reject', adminAuth, async (req, res) => {
  await Testimonial.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// Partners admin
app.get('/admin/partners', adminAuth, async (req, res) => {
  const partners = await CarPartner.find().sort({ createdAt: -1 });
  res.render('admin/partners', { partners });
});
app.post('/admin/partners/:id/approve', adminAuth, async (req, res) => {
  const p = await CarPartner.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
  await sendEmail(p.email, 'Your registration is approved – Brajwasi Tour & Travels',
    `<div style="font-family:Arial,max-width:500px"><h2 style="color:#1A7A3A">Registration Approved!</h2>
     <p>Hello ${p.ownerName},</p><p>Your car ${p.carModel} (${p.carNumber}) has been approved by Brajwasi Tour & Travels.</p>
     <p>You will receive booking assignments by email. A ${p.commissionPct}% commission applies on every completed trip.</p>
     <p>Thank you for joining our fleet!</p></div>`);
  res.json({ success: true });
});
app.post('/admin/partners/:id/reject', adminAuth, async (req, res) => {
  const p = await CarPartner.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
  await sendEmail(p.email, 'Registration update – Brajwasi Tour & Travels',
    `<div style="font-family:Arial,max-width:500px"><h2 style="color:#C0392B">Registration Not Approved</h2>
     <p>Hello ${p.ownerName},</p><p>Unfortunately your registration could not be approved at this time. Please contact us at 9411061000 for more information.</p></div>`);
  res.json({ success: true });
});
app.delete('/admin/partners/:id/doc', adminAuth, async (req, res) => {
  const { docField } = req.body;
  const allowed = ['licensePhoto','rcPhoto','insurancePhoto'];
  if (!allowed.includes(docField)) return res.status(400).json({ error: 'Invalid document field' });
  const partner = await CarPartner.findById(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const filePath = partner[docField];
  if (filePath) {
    try { fs.unlinkSync(path.join(__dirname, 'public', filePath)); } catch(e) {}
    await CarPartner.findByIdAndUpdate(req.params.id, { [docField]: null });
  }
  res.json({ success: true });
});
app.delete('/admin/partners/:id', adminAuth, async (req, res) => {
  await CarPartner.findByIdAndDelete(req.params.id);
  res.redirect('/admin/partners');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Brajwasi running on port ${PORT}`));
