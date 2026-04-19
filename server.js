require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const webpush = require('web-push');
const connectDB = require('./config/db');
const { Car, Booking, PushSubscription, ChatSession } = require('./models');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Secure token for admin socket identification
const ADMIN_SOCKET_TOKEN = crypto.randomBytes(32).toString('hex');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:brajwasitravels.1980@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

connectDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const sessionMW = session({
  secret: process.env.SESSION_SECRET || 'brajwasi_2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
});
app.use(sessionMW);

// Multer
const stor = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: stor, limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Images only'))
});
if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true });

// ===== EMAIL =====
const sendEmail = async (subject, html) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('⚠️  Email skipped – set EMAIL_USER and EMAIL_PASS env vars');
    return false;
  }
  try {
    const t = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 587, secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      tls: { rejectUnauthorized: false }
    });
    const info = await t.sendMail({
      from: `"Brajwasi Travels" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject, html
    });
    console.log('✅ Email sent:', info.messageId);
    return true;
  } catch (e) {
    console.error('❌ Email failed:', e.message);
    return false;
  }
};

// ===== TARGETED PUSH HELPERS =====

// Send ONLY to admin subscriptions
const pushAdmin = async (title, body, data = {}) => {
  if (!process.env.VAPID_PUBLIC_KEY) return;
  const subs = await PushSubscription.find({ role: 'admin' });
  if (!subs.length) return;
  const payload = JSON.stringify({ title, body, ...data });
  await Promise.allSettled(subs.map(s =>
    webpush.sendNotification(s, payload).catch(async err => {
      if (err.statusCode === 410) await PushSubscription.deleteOne({ endpoint: s.endpoint });
    })
  ));
};

// Send ONLY to a specific customer by their identifier (sessionId or phone)
const pushCustomer = async (identifier, title, body, data = {}) => {
  if (!process.env.VAPID_PUBLIC_KEY || !identifier) return;
  const subs = await PushSubscription.find({ role: 'customer', identifier });
  if (!subs.length) return;
  const payload = JSON.stringify({ title, body, ...data });
  await Promise.allSettled(subs.map(s =>
    webpush.sendNotification(s, payload).catch(async err => {
      if (err.statusCode === 410) await PushSubscription.deleteOne({ endpoint: s.endpoint });
    })
  ));
};

// ===== SOCKET.IO =====
io.on('connection', socket => {
  const q = socket.handshake.query;

  // --- ADMIN (token-based auth) ---
  if (q.adminToken === ADMIN_SOCKET_TOKEN) {
    socket.join('admin-room');
    console.log('✅ Admin socket connected:', socket.id);

    socket.on('admin-msg', async ({ sessionId, text }) => {
      if (!text || !sessionId) return;
      const chat = await ChatSession.findOne({ sessionId });
      if (!chat) return;
      const msg = { sender: 'admin', text: text.trim(), timestamp: new Date(), read: true };
      chat.messages.push(msg);
      chat.lastMessage = text.trim();
      chat.lastMessageAt = new Date();
      await chat.save();
      // Deliver to that customer's socket room only
      io.to('cust-' + sessionId).emit('msg', { sender: 'admin', text: text.trim(), ts: msg.timestamp });
      // Update admin chat list
      io.to('admin-room').emit('chat-list-update', { sessionId });
      // Push to this specific customer only
      await pushCustomer(sessionId, '💬 Brajwasi Travels', text.trim().substring(0, 80), {
        url: '/', type: 'admin_reply', sessionId
      });
    });

    socket.on('admin-read', async ({ sessionId }) => {
      await ChatSession.updateOne({ sessionId }, { $set: { unreadCount: 0 } });
    });

    socket.on('driver-location', async ({ bookingId, lat, lng }) => {
      await Booking.findOneAndUpdate({ bookingId }, {
        driverLat: lat, driverLng: lng, driverLocationUpdatedAt: new Date()
      });
      io.to('track-' + bookingId).emit('location-update', { lat, lng, ts: new Date() });
    });

    return;
  }

  // --- CUSTOMER CHAT ---
  const sessionId = q.sessionId;
  if (sessionId) {
    socket.join('cust-' + sessionId);

    socket.on('cust-msg', async ({ sessionId, text, name, phone }) => {
      if (!text || !sessionId) return;
      const cleanText = text.trim();
      let chat = await ChatSession.findOne({ sessionId });
      if (!chat) {
        chat = new ChatSession({
          sessionId, customerName: name || 'Guest',
          customerPhone: phone || '', messages: [], unreadCount: 0
        });
      }
      chat.messages.push({ sender: 'customer', text: cleanText, timestamp: new Date(), read: false });
      chat.unreadCount = (chat.unreadCount || 0) + 1;
      chat.lastMessage = cleanText;
      chat.lastMessageAt = new Date();
      if (name) chat.customerName = name;
      if (phone) chat.customerPhone = phone;
      await chat.save();

      // Notify admin socket room
      io.to('admin-room').emit('new-cust-msg', {
        sessionId, text: cleanText,
        senderName: chat.customerName,
        phone: chat.customerPhone,
        ts: new Date(),
        unread: chat.unreadCount
      });

      // Push notification → ADMIN ONLY
      await pushAdmin(`💬 ${chat.customerName}`, cleanText.substring(0, 80), {
        url: '/admin', type: 'chat', sessionId
      });
    });
  }

  // --- BOOKING TRACKER ---
  const trackId = q.trackId;
  if (trackId) socket.join('track-' + trackId);
});

// ===== PUBLIC ROUTES =====

app.get('/admin-socket-token', (req, res) => {
  if (!req.session.admin) return res.status(403).json({ error: 'Forbidden' });
  res.json({ token: ADMIN_SOCKET_TOKEN });
});

app.get('/', async (req, res) => {
  const cars = await Car.find({ isActive: true });
  res.render('index', { cars });
});

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

// Subscribe endpoint — accepts role and identifier
// role: 'admin' | 'customer'
// identifier: 'admin' for admin, sessionId for customers
app.post('/subscribe', async (req, res) => {
  try {
    const { endpoint, keys, role, identifier } = req.body;
    if (!endpoint || !keys) return res.status(400).json({ error: 'Missing subscription data' });
    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { endpoint, keys, role: role || 'customer', identifier: identifier || '' },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (e) {
    console.error('Subscribe error:', e.message);
    res.json({ success: false });
  }
});

// Customer chat history
app.get('/api/chat/:sid', async (req, res) => {
  const chat = await ChatSession.findOne({ sessionId: req.params.sid }).lean();
  if (!chat) return res.json({ messages: [], customerName: '' });
  res.json({ messages: chat.messages, customerName: chat.customerName, phone: chat.customerPhone });
});

// Booking tracking page
app.get('/track', (req, res) => res.render('track'));

app.get('/api/track', async (req, res) => {
  const { bookingId, phone } = req.query;
  if (!bookingId && !phone) return res.json({ error: 'Enter booking ID or phone number' });
  let booking;
  if (bookingId) booking = await Booking.findOne({ bookingId: bookingId.toUpperCase().trim() });
  else booking = await Booking.findOne({ customerPhone: phone.trim() }).sort({ createdAt: -1 });
  if (!booking) return res.json({ error: 'No booking found. Check your Booking ID or phone number.' });

  const msgs = {
    pending: 'Your booking request has been received.',
    advance_pending: 'Please pay ₹500 advance to confirm your booking.',
    confirmed: '✅ Booking confirmed! Driver details will be shared before journey.',
    completed: '✅ Trip completed. Thank you for choosing Brajwasi Travels!',
    cancelled: 'This booking has been cancelled.'
  };

  res.json({
    bookingId: booking.bookingId, carName: booking.carName,
    customerName: booking.customerName, customerPhone: booking.customerPhone,
    pickupLocation: booking.pickupLocation, dropLocation: booking.dropLocation,
    journeyDate: booking.journeyDate, journeyTime: booking.journeyTime,
    estimatedKm: booking.estimatedKm, totalPrice: booking.totalPrice,
    status: booking.status, statusMessage: booking.statusMessage || msgs[booking.status] || '',
    driverName: booking.driverName || '', driverPhone: booking.driverPhone || '',
    driverLat: booking.driverLat || null, driverLng: booking.driverLng || null,
    tracker24Id: booking.tracker24Id || '', advancePaid: booking.advancePaid,
    createdAt: booking.createdAt
  });
});

// Book a car
app.post('/api/book', async (req, res) => {
  try {
    const { carId, customerName, customerPhone, customerEmail,
      pickupLocation, dropLocation, journeyDate, journeyTime, estimatedKm, notes } = req.body;

    if (!carId || !customerName || !customerPhone || !pickupLocation || !dropLocation || !journeyDate || !journeyTime)
      return res.status(400).json({ error: 'Please fill all required fields' });

    const car = await Car.findById(carId);
    if (!car) return res.status(404).json({ error: 'Car not found' });

    const km = parseInt(estimatedKm) || 0;
    let totalPrice = 0;
    if (km > 0) {
      if (car.fixedPackage?.km && km <= car.fixedPackage.km) totalPrice = car.fixedPackage.price;
      else if (car.fixedPackage?.km) totalPrice = car.fixedPackage.price + ((km - car.fixedPackage.km) * car.extraKmCharge);
      else totalPrice = km * car.pricePerKm;
    }

    const booking = await Booking.create({
      bookingId: 'BT-' + uuidv4().split('-')[0].toUpperCase(),
      car: carId, carName: `${car.name} ${car.model}`,
      customerName, customerPhone, customerEmail: customerEmail || '',
      pickupLocation, dropLocation, journeyDate: new Date(journeyDate), journeyTime,
      estimatedKm: km, totalPrice, notes: notes || '', status: 'advance_pending'
    });

    // Push → ADMIN ONLY (new booking notification)
    await pushAdmin('🚗 New Booking – Brajwasi',
      `${customerName} | ${pickupLocation}→${dropLocation}`,
      { url: '/admin', type: 'booking', bookingId: booking.bookingId }
    );

    const dateStr = new Date(journeyDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    await sendEmail(`🚗 New Booking ${booking.bookingId} – ${customerName}`,
      `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #E8DDD0;border-radius:12px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#B8731A,#D4882A);padding:20px 26px">
          <h2 style="color:#fff;margin:0;font-size:20px">🚗 New Booking Received</h2>
          <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:12px">Brajwasi Tour & Travels, Agra</p>
        </div>
        <div style="padding:22px 26px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr style="background:#FFF8EE"><td style="padding:9px 12px;font-weight:bold;color:#7D4E00;width:38%">Booking ID</td><td style="padding:9px 12px;color:#B8731A;font-weight:800;font-size:15px;letter-spacing:1px">${booking.bookingId}</td></tr>
            <tr><td style="padding:9px 12px;font-weight:bold;color:#555">Customer</td><td style="padding:9px 12px">${customerName}</td></tr>
            <tr style="background:#FFF8EE"><td style="padding:9px 12px;font-weight:bold;color:#555">Phone</td><td style="padding:9px 12px"><a href="tel:${customerPhone}" style="color:#B8731A;font-weight:bold">${customerPhone}</a></td></tr>
            <tr><td style="padding:9px 12px;font-weight:bold;color:#555">Email</td><td style="padding:9px 12px">${customerEmail || '—'}</td></tr>
            <tr style="background:#FFF8EE"><td style="padding:9px 12px;font-weight:bold;color:#555">Car</td><td style="padding:9px 12px">${car.name} ${car.model}</td></tr>
            <tr><td style="padding:9px 12px;font-weight:bold;color:#555">From</td><td style="padding:9px 12px">📍 ${pickupLocation}</td></tr>
            <tr style="background:#FFF8EE"><td style="padding:9px 12px;font-weight:bold;color:#555">To</td><td style="padding:9px 12px">🏁 ${dropLocation}</td></tr>
            <tr><td style="padding:9px 12px;font-weight:bold;color:#555">Date & Time</td><td style="padding:9px 12px">📅 ${dateStr} at ${journeyTime}</td></tr>
            <tr style="background:#FFF8EE"><td style="padding:9px 12px;font-weight:bold;color:#555">Distance</td><td style="padding:9px 12px">${km ? km + ' km' : '—'}</td></tr>
            <tr><td style="padding:9px 12px;font-weight:bold;color:#555">Est. Fare</td><td style="padding:9px 12px;color:#1A7A3A;font-weight:bold;font-size:15px">${totalPrice ? '₹' + totalPrice.toLocaleString('en-IN') : 'TBD'}</td></tr>
            ${notes ? `<tr style="background:#FFF8EE"><td style="padding:9px 12px;font-weight:bold;color:#555">Notes</td><td style="padding:9px 12px">${notes}</td></tr>` : ''}
          </table>
          <div style="background:#FFF3CD;border:1px solid #FFEAA0;border-radius:8px;padding:11px 14px;margin-top:14px;font-size:13px;color:#7D4E00">⏳ Awaiting ₹500 advance payment</div>
          <div style="text-align:center;margin-top:18px">
            <a href="${process.env.BASE_URL || 'https://brajwasi-travels.onrender.com'}/admin" style="background:linear-gradient(135deg,#B8731A,#D4882A);color:#fff;padding:11px 24px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:13px">View in Admin Panel →</a>
          </div>
        </div>
        <div style="background:#F8F4EF;padding:11px;text-align:center;font-size:11px;color:#999">Brajwasi Tour & Travels · Agra · Est. 2018 · 9411061000</div>
      </div>`
    );

    res.json({ success: true, bookingId: booking.bookingId, totalPrice });
  } catch (e) {
    console.error('Booking error:', e);
    res.status(500).json({ error: 'Server error. Please call 9411061000' });
  }
});

// ===== ADMIN ROUTES =====
const adminAuth = (req, res, next) => req.session.admin ? next() : res.redirect('/admin/login');

app.get('/admin', adminAuth, async (req, res) => {
  const [cars, bookings] = await Promise.all([
    Car.find().sort({ createdAt: -1 }),
    Booking.find().sort({ createdAt: -1 }).limit(10)
  ]);
  const stats = {
    totalCars: await Car.countDocuments({ isActive: true }),
    totalBookings: await Booking.countDocuments(),
    pendingBookings: await Booking.countDocuments({ status: { $in: ['pending', 'advance_pending'] } }),
    confirmedBookings: await Booking.countDocuments({ status: 'confirmed' })
  };
  res.render('admin/dashboard', { cars, bookings, stats });
});

app.get('/admin/login', (req, res) => {
  if (req.session.admin) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});
app.post('/admin/login', (req, res) => {
  if (req.body.username === (process.env.ADMIN_USERNAME || 'admin') &&
    req.body.password === (process.env.ADMIN_PASSWORD || 'brajwasi@2024')) {
    req.session.admin = true;
    return res.redirect('/admin');
  }
  res.render('admin/login', { error: 'Invalid credentials' });
});
app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

// Cars CRUD
app.post('/admin/cars/add', adminAuth, upload.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const imgPath = req.file ? '/uploads/' + req.file.filename : '/images/default-crysta.jpg';
  const ppk = Number(pricePerKm), fkm = fixedKm ? Number(fixedKm) : null;
  const fp = fixedPrice ? Number(fixedPrice) : (fkm ? fkm * ppk - 400 : null);
  await Car.create({
    name, model, image: imgPath, pricePerKm: ppk,
    fixedPackage: fkm ? { km: fkm, price: fp } : undefined,
    extraKmCharge: Number(extraKmCharge),
    tollTax: tollTax || 'As per actual',
    availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'],
    seats: Number(seats) || 4, ac: ac === 'true', description
  });
  res.redirect('/admin');
});

app.get('/admin/cars/:id/edit', adminAuth, async (req, res) => {
  const car = await Car.findById(req.params.id);
  if (!car) return res.redirect('/admin');
  res.render('admin/edit-car', { car });
});
app.post('/admin/cars/:id/edit', adminAuth, upload.single('image'), async (req, res) => {
  const { name, model, pricePerKm, fixedKm, fixedPrice, extraKmCharge, tollTax, availableIn, seats, ac, description } = req.body;
  const ppk = Number(pricePerKm), fkm = fixedKm ? Number(fixedKm) : null;
  const fp = fixedPrice ? Number(fixedPrice) : (fkm ? fkm * ppk - 400 : null);
  const upd = { name, model, pricePerKm: ppk, fixedPackage: fkm ? { km: fkm, price: fp } : undefined,
    extraKmCharge: Number(extraKmCharge), tollTax: tollTax || 'As per actual',
    availableIn: availableIn ? availableIn.split(',').map(s => s.trim()) : ['Agra'],
    seats: Number(seats) || 4, ac: ac === 'true', description };
  if (req.file) upd.image = '/uploads/' + req.file.filename;
  await Car.findByIdAndUpdate(req.params.id, upd);
  res.redirect('/admin');
});
app.post('/admin/cars/:id/toggle', adminAuth, async (req, res) => {
  const c = await Car.findById(req.params.id);
  if (c) { c.isActive = !c.isActive; await c.save(); }
  res.redirect('/admin');
});
app.post('/admin/cars/:id/availability', adminAuth, async (req, res) => {
  const c = await Car.findById(req.params.id);
  if (c) { c.isAvailable = !c.isAvailable; await c.save(); }
  res.json({ success: true, isAvailable: c ? c.isAvailable : false });
});
app.post('/admin/cars/:id/delete', adminAuth, async (req, res) => {
  await Car.findByIdAndDelete(req.params.id);
  res.redirect('/admin');
});

// Bookings
app.get('/admin/bookings', adminAuth, async (req, res) => {
  const bookings = await Booking.find().sort({ createdAt: -1 });
  res.render('admin/bookings', { bookings });
});
app.post('/admin/bookings/:id/status', adminAuth, async (req, res) => {
  const { status, statusMessage, driverName, driverPhone, tracker24Id } = req.body;
  const upd = { status };
  if (statusMessage) upd.statusMessage = statusMessage;
  if (driverName) upd.driverName = driverName;
  if (driverPhone) upd.driverPhone = driverPhone;
  if (tracker24Id) upd.tracker24Id = tracker24Id;
  const booking = await Booking.findByIdAndUpdate(req.params.id, upd, { new: true });

  if (status === 'confirmed' && booking) {
    // Push → that SPECIFIC CUSTOMER only (by phone number)
    await pushCustomer(booking.customerPhone,
      '✅ Booking Confirmed – Brajwasi Travels',
      `Your booking ${booking.bookingId} is confirmed!${driverName ? ' Driver: ' + driverName : ''} Track at /track`,
      { url: '/track?bookingId=' + booking.bookingId, type: 'booking_confirmed' }
    );
  }
  res.redirect('/admin/bookings');
});
app.post('/admin/bookings/:id/advance', adminAuth, async (req, res) => {
  await Booking.findByIdAndUpdate(req.params.id, { advancePaid: true, status: 'confirmed' });
  res.redirect('/admin/bookings');
});
app.post('/admin/bookings/:id/location', adminAuth, async (req, res) => {
  const { lat, lng } = req.body;
  const booking = await Booking.findByIdAndUpdate(req.params.id, {
    driverLat: parseFloat(lat), driverLng: parseFloat(lng), driverLocationUpdatedAt: new Date()
  }, { new: true });
  if (booking) io.to('track-' + booking.bookingId).emit('location-update', { lat: parseFloat(lat), lng: parseFloat(lng), ts: new Date() });
  res.json({ success: true });
});

// Push – admin only, send to admin devices only
app.post('/admin/push', adminAuth, async (req, res) => {
  await pushAdmin(req.body.title, req.body.body);
  res.json({ success: true });
});

// Chat routes — list and clear MUST be before :sid
app.get('/admin/chat/list', adminAuth, async (req, res) => {
  const chats = await ChatSession.find().sort({ lastMessageAt: -1 }).lean();
  res.json({ chats });
});
app.delete('/admin/chat/:sid/clear', adminAuth, async (req, res) => {
  await ChatSession.updateOne({ sessionId: req.params.sid },
    { $set: { messages: [], lastMessage: '', unreadCount: 0 } });
  res.json({ success: true });
});
app.get('/admin/chat/:sid', adminAuth, async (req, res) => {
  const chat = await ChatSession.findOne({ sessionId: req.params.sid }).lean();
  if (!chat) return res.json({ chat: { messages: [], customerName: '', customerPhone: '' } });
  await ChatSession.updateOne({ sessionId: req.params.sid }, { $set: { unreadCount: 0 } });
  res.json({ chat });
});

app.get('/google:code.html', (req, res) => {
  res.send(`google-site-verification: google${req.params.code}.html`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Brajwasi Travels on port ${PORT}`));
