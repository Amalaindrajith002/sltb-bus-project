const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const nodemailer = require('nodemailer');

// Email Transporter Configuration (Gmail හෝ වෙනත් SMTP සේවාවක් සඳහා)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'your_email@gmail.com', // ඔයාගේ ඊමේල් එක මෙතනට දෙන්න
        pass: 'your_email_app_password' // Gmail App Password එක මෙතනට දෙන්න
    }
});

const app = express();
app.use(express.json());
app.use(cors());
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// MySQL Database Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', // XAMPP වල සාමාන්‍‍යයෙන් පාස්වර්ඩ් එක හිස්ය
    database: 'sltb_bus_db'
});

db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('Connected to MySQL Database successfully!');
});

// Serve Frontend index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Server එක Run කිරීම
const PORT = process.env.PORT || 5000;
// 1. Bus Owner Registration (බස් හිමියෙකු ලියාපදිංචි වීම)
app.post('/api/owner/register', (req, res) => {
    const { name, company_name, phone, email, password } = req.body;
    
    const query = 'INSERT INTO bus_owners (name, company_name, phone, email, password, status) VALUES (?, ?, ?, ?, ?, "pending")';
    
    db.query(query, [name, company_name, phone, email, password], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Bus owner registered successfully. Waiting for admin approval.', ownerId: result.insertId });
    });
});

// --- User Authentication APIs ---

// 1. Passenger / User Registration
app.post('/api/auth/register', (req, res) => {
    const { name, email, phone, password, role } = req.body;
    
    const query = 'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)';
    db.query(query, [name, email, phone, password, role || 'passenger'], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'User registered successfully!', userId: result.insertId });
    });
});

// 2. User / Owner Login
app.post('/api/auth/login', (req, res) => {
    const { email, password, userType } = req.body; // userType: 'passenger', 'owner', 'admin'

    let tableName = 'users';
    if (userType === 'owner') {
        tableName = 'bus_owners';
    } else if (userType === 'admin') {
        tableName = 'users'; // හෝ ඇඩ්මින් සඳහා වෙනම ටේබල් එකක් නම් එය දෙන්න
    }

    const query = `SELECT * FROM ${tableName} WHERE email = ? AND password = ?`;
    db.query(query, [email, password], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });

        if (results.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password!' });
        }

        const user = results[0];

        // පෞද්ගලික බස් හිමියන් සඳහා ඇඩ්මින් අනුමැතිය (Approval) පරීක්ෂා කිරීම
        if (userType === 'owner' && user.status !== 'approved') {
            return res.status(403).json({ message: 'Your account is pending admin approval!' });
        }

        res.json({ 
            message: 'Login successful!', 
            user: { id: user.id, name: user.name, email: user.email, role: user.role || userType } 
        });
    });
});


// 2. Admin: Get all pending bus owners (අනුමත වීමට ඇති බස් හිමියන් බලාගැනීම)
app.get('/api/admin/pending-owners', (req, res) => {
    const query = 'SELECT id, name, company_name, phone, email, status, created_at FROM bus_owners WHERE status = "pending"';
    
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// 3. Admin: Approve or Reject Bus Owner (බස් හිමියෙකු අනුමත කිරීම හෝ ප්‍රතික්ෂේප කිරීම)
app.put('/api/admin/approve-owner/:id', (req, res) => {
    const ownerId = req.params.id;
    const { status } = req.body; // 'approved' හෝ 'rejected' විය යුතුය
    
    const query = 'UPDATE bus_owners SET status = ? WHERE id = ?';
    
    db.query(query, [status, ownerId], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: `Bus owner status updated to ${status} successfully.` });
    });
});

// 4. Register a Bus (බස් හිමියා විසින් බස් රථයක් ලියාපදිංචි කිරීම)
app.post('/api/buses', (req, res) => {
    const { owner_id, bus_number, bus_type, total_seats, is_sltb } = req.body;
    
    const query = 'INSERT INTO buses (owner_id, bus_number, bus_type, total_seats, is_sltb) VALUES (?, ?, ?, ?, ?)';
    
    db.query(query, [owner_id, bus_number, bus_type, total_seats, is_sltb || false], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Bus registered successfully.', busId: result.insertId });
    });
});

// 5. Add Bus Schedule / Route (බස් එකට ගමන් මාර්ග සහ කාලසටහන් එකතු කිරීම)
app.post('/api/schedules', (req, res) => {
    const { bus_id, route_number, origin, destination, departure_time, arrival_time, fare } = req.body;
    
    const query = 'INSERT INTO schedules (bus_id, route_number, origin, destination, departure_time, arrival_time, fare) VALUES (?, ?, ?, ?, ?, ?, ?)';
    
    db.query(query, [bus_id, route_number, origin, destination, departure_time, arrival_time, fare], (err, result) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: 'Schedule added successfully.', scheduleId: result.insertId });
    });
});

// 6. Search Buses / Schedules (මගීන්ට බස් සෙවීම සඳහා API එක)
app.get('/api/schedules/search', (req, res) => {
    const { origin, destination } = req.query;
    
    const query = `
        SELECT s.*, b.bus_number, b.bus_type, b.total_seats, b.is_sltb 
        FROM schedules s 
        JOIN buses b ON s.bus_id = b.id 
        WHERE s.origin LIKE ? AND s.destination LIKE ?
    `;
    
    db.query(query, [`%${origin}%`, `%${destination}%`], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// 7. Book a Seat (මගියෙකු විසින් ආසනයක් වෙන් කරවා ගැනීම)

// Advanced Concurrency Control with Database Transactions & Row Locking
app.post('/api/bookings', (req, res) => {
    const { user_id, schedule_id, seat_number, payment_status } = req.body;

    // 1. Transaction එකක් ආරම්භ කිරීම
    db.beginTransaction((err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        // 2. අදාළ ෂෙඩියුල් එකට අදාළ සීට් එක දැනටමත් බුක් කර ඇද්දැයි බැලීම සඳහා Lock කිරීම (FOR UPDATE)
        const checkQuery = 'SELECT * FROM bookings WHERE schedule_id = ? AND seat_number = ? AND booking_status = "confirmed" FOR UPDATE';
        
        db.query(checkQuery, [schedule_id, seat_number], (err, results) => {
            if (err) {
                return db.rollback(() => {
                    res.status(500).json({ error: err.message });
                });
            }

            // සීට් එක මීට පෙර බුක් කර ඇත්නම්
            if (results.length > 0) {
                return db.rollback(() => {
                    res.status(400).json({ message: 'මෙම ආසනය දැනටමත් වෙනත් මගියෙකු විසින් වෙන් කරවාගෙන ඇත!' });
                });
            }

            // 3. සීට් එක හිස් නම් බුක් කිරීම ඇතුළත් කිරීම
            const insertQuery = 'INSERT INTO bookings (user_id, schedule_id, seat_number, payment_status, booking_status) VALUES (?, ?, ?, ?, "confirmed")';
            
            db.query(insertQuery, [user_id, schedule_id, seat_number, payment_status || 'cash_on_bus'], (err, result) => {
                if (err) {
                    return db.rollback(() => {
                        res.status(500).json({ error: err.message });
                    });
                }

                // 4. සියල්ල සාර්ථක නම් Transaction එක Commit කිරීම
                db.commit((err) => {
                    if (err) {
                        return db.rollback(() => {
                            res.status(500).json({ error: err.message });
                        });
                    }

                    res.status(201).json({ 
                        message: 'ආසනය සාර්ථකව වෙන් කරන ලදී!', 
                        bookingId: result.insertId 
                    });
                });
            });
        });
    });
});
app.post('/api/bookings', (req, res) => {
    const { user_id, schedule_id, seat_number, payment_status } = req.body;
    
    // මුලින්ම අදාළ සීට් එක ඒ schedule එකට කලින් බුක් කරලා තියෙනවද බලමු
    const checkQuery = 'SELECT * FROM bookings WHERE schedule_id = ? AND seat_number = ? AND booking_status = "confirmed"';
    
    db.query(checkQuery, [schedule_id, seat_number], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        
        if (results.length > 0) {
            return res.status(400).json({ message: 'This seat is already booked!' });
        }
        
        // සීට් එක හිස් නම් බුක් කිරීම සිදු කිරීම
        const insertQuery = 'INSERT INTO bookings (user_id, schedule_id, seat_number, payment_status, booking_status) VALUES (?, ?, ?, ?, "confirmed")';
        
        db.query(insertQuery, [user_id, schedule_id, seat_number, payment_status || 'cash_on_bus'], (err, result) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.status(201).json({ message: 'Seat booked successfully!', bookingId: result.insertId });
        });
    });
});
// Verify Ticket by Booking ID (For Conductors)
app.get('/api/bookings/verify/:id', (req, res) => {
    const bookingId = req.params.id;
    const query = `
        SELECT bookings.*, schedules.route_number, schedules.origin, schedules.destination, schedules.departure_time, buses.bus_number, buses.bus_type 
        FROM bookings 
        JOIN schedules ON bookings.schedule_id = schedules.id 
        JOIN buses ON schedules.bus_id = buses.id 
        WHERE bookings.id = ? AND bookings.booking_status = 'confirmed'
    `;

    db.query(query, [bookingId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) {
            return res.status(404).json({ message: 'Ticket not found or invalid!' });
        }
        res.json(results[0]);
    });
});

// 8. Get Bookings by User (පාරිභෝගිකයා බුක් කළ ටිකට් විස්තර බලාගැනීම) - නිවැරදි කළ කෝඩ් කොටස
app.get('/api/bookings/user/:user_id', (req, res) => {
    const userId = req.params.user_id;
    
    const query = `
        SELECT bk.id AS booking_id, bk.seat_number, bk.booking_status, bk.payment_status,
        s.route_number, s.origin, s.destination, s.departure_time, s.fare,
        b.bus_number, b.bus_type
        FROM bookings bk
        JOIN schedules s ON bk.schedule_id = s.id
        JOIN buses b ON s.bus_id = b.id
        WHERE bk.user_id = ?
    `;
    
    db.query(query, [userId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

// Get booked seats for a specific schedule
app.get('/api/bookings/schedule/:schedule_id', (req, res) => {
    const scheduleId = req.params.schedule_id;
    const query = 'SELECT seat_number FROM bookings WHERE schedule_id = ? AND booking_status = "confirmed"';
    db.query(query, [scheduleId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        const bookedSeats = results.map(row => row.seat_number);
        res.json(bookedSeats);
    });
});
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});