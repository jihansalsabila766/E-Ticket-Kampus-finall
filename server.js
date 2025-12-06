// server.js (SAFE version)
require('dotenv').config(); // <-- PENTING: harus paling atas

const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const QRCode = require('qrcode');
const cors = require('cors');
const { nanoid } = require('nanoid');
const fs = require('fs');
const midtransClient = require('midtrans-client'); // ✅ Tambahkan import ini
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Pastikan folder images ada
const imagesFolder = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(imagesFolder)) {
  fs.mkdirSync(imagesFolder, { recursive: true });
}

// Konfigurasi multer untuk penyimpanan file gambar
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/images/')
  },
  filename: function (req, file, cb) {
    cb(null, req.body.id + path.extname(file.originalname))
  }
});

const upload = multer({ storage: storage });

// ===================== DATABASE FIX RAILWAY ===================== //
// Railway membutuhkan folder /mnt/data untuk penyimpanan persist

const persistentDir = "/mnt/data";

if (!fs.existsSync(persistentDir)) {
    fs.mkdirSync(persistentDir, { recursive: true });
    console.log("📁 Folder /mnt/data dibuat.");
}

const dbPath = path.join(persistentDir, "tickets.db");
console.log("📦 Database disimpan di:", dbPath);

// Buat koneksi database
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("❌ Gagal membuka database:", err);
    } else {
        console.log("✅ Database berhasil dibuka!");
    }
});

// ================== CREATE TABLE ==================
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT,
    date TEXT,
    price INTEGER,
    location TEXT,
    image TEXT DEFAULT 'default.jpg'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    event_id TEXT,
    buyer_name TEXT,
    buyer_email TEXT,
    status TEXT,
    created_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT
  )`);
});

// ================== SEED DATA EVENTS ==================
db.all("SELECT COUNT(*) as count FROM events", (err, rows) => {
  if (!err && rows[0].count === 0) {
    const stmt = db.prepare(`
      INSERT INTO events (id, title, description, date, price, location)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const defaultEvents = [
      ["EVT001", "Seminar AI", "Seminar AI untuk masa depan cerah!", "2025-12-15", 55000, "Aula Gedung Informatika Lt.3"],
      ["EVT002", "Konser Musik Kampus", "Konser musik mahasiswa dengan bintang tamu spesial.", "2025-11-20", 75000, "Lapangan Utama Kampus"],
      ["EVT003", "Lomba Startup", "Kompetisi startup antar jurusan dengan hadiah menarik.", "2025-10-10", 100000, "Auditorium Fakultas Ekonomi"],
      ["EVT004", "Workshop UI/UX", "Pelatihan desain antarmuka modern untuk aplikasi mobile.", "2025-09-25", 30000, "Lab Komputer 2 Gedung Teknik"],
      ["EVT005", "Hackathon 24 Jam", "Ayo coding marathon selama 24 jam!", "2025-12-05", 0, "Coworking Space Kampus Center"],
      ["EVT006", "Seminar Bisnis Digital", "Kupas tuntas peluang bisnis di era digital.", "2025-11-01", 40000, "Aula Fakultas Bisnis"],
      ["EVT007", "Talkshow Technopreneurship", "Inspirasi dari alumni sukses dalam dunia startup.", "2025-11-18", 25000, "Ruang Serbaguna Gedung A"],
      ["EVT008", "Pameran Teknologi Kampus", "Demo teknologi inovatif karya mahasiswa.", "2025-12-10", 20000, "Hall Utama Gedung Rektorat"]
    ];

    defaultEvents.forEach(ev => stmt.run(ev));
    stmt.finalize();
    console.log("✅ 8 event default berhasil dimasukkan ke database.");
  }
});

// ---------------- Midtrans config (from ENV, NOT hardcoded) ----------------
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;

if (!MIDTRANS_SERVER_KEY || !MIDTRANS_CLIENT_KEY) {
  console.warn('⚠️ Warning: MIDTRANS_SERVER_KEY or MIDTRANS_CLIENT_KEY is not set in environment variables.');
}

// Create Snap & CoreApi instances
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_PRODUCTION === 'true' || false,
  serverKey: MIDTRANS_SERVER_KEY,
  clientKey: MIDTRANS_CLIENT_KEY
});
const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_PRODUCTION === 'true' || false,
  serverKey: MIDTRANS_SERVER_KEY,
  clientKey: MIDTRANS_CLIENT_KEY
});

// Helper: create ticket record
function createTicketRecord(ticketId, orderId, event_id, buyer_name, buyer_email, status = 'pending') {
  db.run(
    'INSERT INTO tickets (id, order_id, event_id, buyer_name, buyer_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [ticketId, orderId, event_id, buyer_name, buyer_email, status, new Date().toISOString()],
    (err) => { if (err) console.error('DB insert ticket error:', err); }
  );
}

// ================== API ROUTES ==================

// 🔹 Ambil semua event
app.get('/api/events', (req, res) => {
  db.all('SELECT * FROM events', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ---------------- Tambah event dengan gambar ----------------
app.post('/api/events', upload.single('image'), (req, res) => {
  const { title, description, date, price, location } = req.body;
  const id = req.body.id || nanoid(8);

  // Jika tidak ada file diupload, pakai default.jpg
  const imageFile = req.file ? req.file.filename : 'default.jpg';

  db.run(
    'INSERT INTO events (id, title, description, date, price, location, image) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, title, description, date, price, location, imageFile],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id, title, description, date, price, location, image: imageFile });
    }
  );
});

// 🔹 Edit event
app.put('/api/events/:id', (req, res) => {
  const { title, description, date, price, location } = req.body;
  const eventId = req.params.id;

  db.run(
    `UPDATE events SET title=?, description=?, date=?, price=?, location=? WHERE id=?`,
    [title, description, date, price, location, eventId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Event tidak ditemukan' });
      res.json({ success: true });
    }
  );
});

// 🔹 Hapus event
app.delete('/api/events/:id', (req, res) => {
  const eventId = req.params.id;
  db.run('DELETE FROM tickets WHERE event_id = ?', [eventId], err => {
    if (err) return res.status(500).json({ error: err.message });
    db.run('DELETE FROM events WHERE id = ?', [eventId], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ success: true });
    });
  });
});

// 🔹 Detail event
app.get('/api/events/:id', (req, res) => {
  db.get('SELECT * FROM events WHERE id=?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Event tidak ditemukan' });
    res.json(row);
  });
});

// 🔹 Checkout (buat transaksi Midtrans) — refactored & alias untuk backward-compatibility
async function handleCheckoutRequest(req, res) {
  try {
    const { event_id, buyer_name, buyer_email } = req.body || {};

    // Validasi input dasar
    if (!event_id || !buyer_name || !buyer_email) {
      return res.status(400).json({ error: 'event_id, buyer_name, buyer_email wajib diisi' });
    }

    console.log("📦 Data diterima:", req.body);

    db.get('SELECT * FROM events WHERE id = ?', [event_id], async (err, event) => {
      if (err) {
        console.error('DB error saat mencari event:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      if (!event) {
        return res.status(404).json({ error: 'Event tidak ditemukan' });
      }

      const price = Number(event.price) || 0;
      const ticketId = nanoid(10);
      const orderId = 'ORDER-' + ticketId;

      // Handle free events
      if (price <= 0) {
        // Create validated ticket immediately for free events
        db.run(
          'INSERT INTO tickets (id, order_id, event_id, buyer_name, buyer_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [ticketId, orderId, event_id, buyer_name, buyer_email, 'valid', new Date().toISOString()],
          async (err) => {
            if (err) {
              console.error('DB error saat membuat tiket:', err);
              return res.status(500).json({ error: 'Gagal membuat tiket' });
            }

            // Generate validation URL and QR code
            const validationUrl = `${req.protocol}://${req.get('host')}/api/validate/${ticketId}`;
            const qrDataUrl = await QRCode.toDataURL(validationUrl);

            return res.json({
              ticketId,
              orderId,
              status: 'valid',
              validationUrl,
              qrDataUrl,
              isFreeEvent: true
            });
          }
        );
        return;
      }

      // Handle paid events (existing code)
      const parameter = {
        transaction_details: {
          order_id: orderId,
          gross_amount: price
        },
        customer_details: {
          first_name: buyer_name,
          email: buyer_email
        },
        item_details: [{
          id: event.id,
          price: price,
          quantity: 1,
          name: event.title
        }],
        callbacks: {
          finish: `${req.protocol}://${req.get('host')}/event.html?id=${event_id}&order_id=${orderId}`,
          error: `${req.protocol}://${req.get('host')}/event.html?id=${event_id}&status=error`,
          pending: `${req.protocol}://${req.get('host')}/event.html?id=${event_id}&status=pending`
        }
      };

      try {
        const transaction = await snap.createTransaction(parameter);
        console.log("✅ Midtrans response:", transaction);

        // Simpan tiket dengan status pending
        db.run(
          'INSERT INTO tickets (id, order_id, event_id, buyer_name, buyer_email, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [ticketId, orderId, event_id, buyer_name, buyer_email, 'pending', new Date().toISOString()]
        );

        res.json({
          ticketId,
          orderId,
          snapToken: transaction.token,
          redirect_url: transaction.redirect_url
        });
      } catch (midErr) {
        console.error('❌ Midtrans createTransaction error:', midErr);
        res.status(500).json({ 
          error: 'Gagal membuat transaksi',
          detail: midErr.message
        });
      }
    });
  } catch (err) {
    console.error('Checkout handler unexpected error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}

// Route utama
app.post('/api/checkout', (req, res) => handleCheckoutRequest(req, res));

// Alias lama (compatibility dengan client lama yang mengirim ke /api/create-ticket)
app.post('/api/create-ticket', (req, res) => handleCheckoutRequest(req, res));

// 🔹 Webhook dari Midtrans (pembaruan status)
app.post('/api/midtrans-notify', express.json(), async (req, res) => {
  try {
    const notification = req.body;
    console.log('Midtrans notification:', notification);

    const orderId = notification.order_id;
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    if (!orderId) {
      return res.status(400).json({ error: 'Missing order_id' });
    }

    let newStatus = 'pending';
    if (transactionStatus === 'capture' && fraudStatus === 'accept') {
      newStatus = 'valid';
    } else if (transactionStatus === 'settlement') {
      newStatus = 'valid';
    } else if (['deny', 'cancel', 'expire'].includes(transactionStatus)) {
      newStatus = 'failed';
    }

    db.run('UPDATE tickets SET status = ? WHERE order_id = ?', 
      [newStatus, orderId], 
      function(err) {
        if (err) {
          console.error('Error updating ticket:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        console.log(`Updated ticket ${orderId} status to ${newStatus}`);
        res.status(200).json({ success: true });
    });

  } catch (err) {
    console.error('Notification handler error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ---------------- Check payment & return ticket info + QR ----------------
app.get('/api/check-payment/:orderId', async (req, res) => {
  const orderId = req.params.orderId;
  
  try {
    // 1. Cek status di database lokal
    db.get('SELECT id as ticketId, status, event_id, buyer_name FROM tickets WHERE order_id = ?', 
      [orderId], 
      async (err, ticket) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        // 2. Jika status masih pending, cek di Midtrans
        if (ticket.status === 'pending') {
          try {
            // Gunakan status API langsung
            const transactionStatus = await snap.transaction.status(orderId);
            console.log('Midtrans status:', transactionStatus);

            if (transactionStatus) {
              // Update status berdasarkan response Midtrans
              if (transactionStatus.transaction_status === 'settlement' || 
                  (transactionStatus.transaction_status === 'capture' && 
                   transactionStatus.fraud_status === 'accept')) {
                
                // Update status menjadi valid
                db.run('UPDATE tickets SET status = ? WHERE order_id = ?', 
                  ['valid', orderId]);
                ticket.status = 'valid';
                
              } else if (['deny', 'cancel', 'expire'].includes(transactionStatus.transaction_status)) {
                db.run('UPDATE tickets SET status = ? WHERE order_id = ?', 
                  ['failed', orderId]);
                ticket.status = 'failed';
              }
              
              ticket.transaction_status = transactionStatus.transaction_status;
            }
          } catch (midtransErr) {
            // Log error tapi lanjutkan
            console.log('Payment check info:', midtransErr.message);
          }
        }

        // 3. Generate QR jika status valid
        if (ticket.status === 'valid') {
          try {
            const validationUrl = `${req.protocol}://${req.get('host')}/api/validate/${ticket.ticketId}`;
            const qrDataUrl = await QRCode.toDataURL(validationUrl);
            return res.json({
              ...ticket,
              validationUrl,
              qrDataUrl
            });
          } catch (qrErr) {
            console.error('QR generation error:', qrErr);
          }
        }

        // 4. Return ticket info
        return res.json(ticket);
    });
  } catch (err) {
    console.error('Check payment error:', err);
    return res.status(500).json({ error: 'Payment check failed' });
  }
});

// ---------------- Validate ticket (used by QR) ----------------
app.get('/api/validate/:ticketId', (req, res) => {
  const ticketId = req.params.ticketId;
  db.get('SELECT t.id, t.status, t.buyer_name, t.created_at, e.title FROM tickets t LEFT JOIN events e ON t.event_id = e.id WHERE t.id = ?', [ticketId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Ticket tidak ditemukan' });

    res.json(row);
  });
});

// Download database
app.get('/download-db', (req, res) => {
  res.download(dbPath, "tickets.db", err => {
    if (err) res.status(500).send("Gagal download DB");
  });
});


// ---------------- Start server ----------------
app.listen(PORT, () => {
  console.log(`✅ Server berjalan di http://localhost:${PORT}`);
});

// Tambahkan endpoint upload gambar
app.post('/api/upload-event-image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ 
    success: true,
    filename: req.file.filename 
  });
});

// ---------------- Event submit handler (from client) ----------------
async function handleEventSubmit(e) {
  e.preventDefault();
  
  // Buat FormData untuk handle file upload
  const formData = new FormData();
  const eventId = nanoid(8); // Generate ID
  
  formData.append('id', eventId);
  formData.append('title', document.getElementById('title').value);
  formData.append('image', document.querySelector('input[type="file"]').files[0]);
  
  try {
    // Upload gambar dulu
    const uploadRes = await fetch('/api/upload-event-image', {
      method: 'POST',
      body: formData
    });
    
    if (!uploadRes.ok) throw new Error('Gagal upload gambar');
    
    // Lanjut submit data event
    const eventData = {
      id: eventId,
      title: document.getElementById('title').value,
      // ...data lainnya
    };
    
    const eventRes = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData)
    });
    
    if (!eventRes.ok) throw new Error('Gagal simpan event');
    
    alert('Event berhasil ditambahkan!');
    // Refresh halaman atau update UI
    
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Tambahkan setelah app.use(express.static...)
app.use((req, res, next) => {
  if (req.url.startsWith('/images/') && !fs.existsSync(path.join(__dirname, 'public', req.url))) {
    return res.sendFile(path.join(__dirname, 'public/images/default.jpg'));
  }
  next();
});

// Tambahkan endpoint baru sebelum app.listen
// 🔹 Get All Tickets with Event Details
app.get('/api/tickets', (req, res) => {
  const query = `
    SELECT 
      t.id as ticket_id,
      t.order_id,
      t.buyer_name,
      t.buyer_email,
      t.status,
      t.created_at,
      e.title as event_title,
      e.price as event_price
    FROM tickets t
    LEFT JOIN events e ON t.event_id = e.id
    ORDER BY t.created_at DESC
  `;

  db.all(query, (err, rows) => {
    if (err) {
      console.error('Error fetching tickets:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Tambahkan endpoint ini sebelum app.listen
// 🔹 Get tickets by event ID
app.get('/api/events/:id/tickets', (req, res) => {
  const eventId = req.params.id;
  
  const query = `
    SELECT 
      tickets.id,
      tickets.order_id,
      tickets.buyer_name,
      tickets.buyer_email,
      tickets.status,
      tickets.created_at
    FROM tickets 
    WHERE tickets.event_id = ?
    ORDER BY tickets.created_at DESC
  `;

  db.all(query, [eventId], (err, tickets) => {
    if (err) {
      console.error('Error fetching tickets:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(tickets);
  });
});


