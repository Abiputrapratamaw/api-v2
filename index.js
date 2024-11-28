const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000;

app.enable("trust proxy");
app.set("json spaces", 2);
 
const {
    convertCRC16,
    generateTransactionId,
    generateExpirationTime,
    elxyzFile,
    createQRIS,
    validateImageFormat
} = require('./orkut.js');

// Middleware
app.use(cors());

// Root endpoint (optional, bisa dihapus jika tidak perlu)
app.get('/', (req, res) => {
    res.status(200).json({
        status: true,
        creator: "AbiDev",
        message: "QRIS Payment Gateway Ready!"
    });
});

// Create QRIS Payment Endpoint
app.get('/api/orkut/createpayment', async (req, res) => {
    const { amount, codeqr, logostore } = req.query;
    
    if (!amount) {
        return res.status(400).json({
            status: false,
            creator: "AbiDev",
            message: "Isi Parameter Amount."
        });
    }
    
    if (!codeqr) {
        return res.status(400).json({
            status: false,
            creator: "AbiDev",
            message: "Isi Parameter CodeQr menggunakan qris code kalian."
        });
    }

    if (logostore && !await validateImageFormat(logostore)) {
        return res.status(400).json({
            status: false,
            creator: "AbiDev",
            message: "Format logo tidak valid. Gunakan JPG atau PNG."
        });
    }

    try {
        // Generate random fee (1-149)
        const randomFee = Math.floor(Math.random() * 149) + 1;
        const totalAmount = parseInt(amount) + randomFee;
        
        // Create QRIS
        const qrData = await createQRIS(totalAmount, codeqr, logostore);
        
        // Send response
        res.json({
            status: true,
            creator: "AbiDev",
            result: {
                kodeTransaksi: generateTransactionId(),
                amount: amount,
                fee: randomFee,
                totalAmount: totalAmount,
                qrImage: qrData.qrImage,
                qrString: qrData.qrString,
                status: "pending",
                withLogo: !!logostore
            }
        });
    } catch (error) {
        console.error('Error creating QRIS:', error);
        res.status(500).json({
            status: false,
            creator: "AbiDev",
            message: error.message
        });
    }
});

// Check Payment Status Endpoint
app.get('/api/orkut/cekstatus', async (req, res) => {
    const { merchant, keyorkut, amount } = req.query;
    
    if (!merchant) {
        return res.status(400).json({
            status: false,
            creator: "AbiDev",
            message: "Isi Parameter Merchant."
        });
    }
    
    if (!keyorkut) {
        return res.status(400).json({
            status: false,
            creator: "AbiDev",
            message: "Isi Parameter Token menggunakan token kalian."
        });
    }

    if (!amount) {
        return res.status(400).json({
            status: false,
            creator: "AbiDev",
            message: "Isi Parameter Amount untuk cek status pembayaran."
        });
    }

    try {
        const apiUrl = `https://gateway.okeconnect.com/api/mutasi/qris/${merchant}/${keyorkut}`;
        const response = await axios.get(apiUrl, {
            timeout: 10000 // 10 detik timeout
        });
        
        const result = response.data;

        if (!result.data || result.data.length === 0) {
            return res.json({
                status: "pending"
            });
        }

        // Cari transaksi yang sesuai dengan amount
        const matchingTransaction = result.data.find(trx => {
            const trxAmount = trx.amount.toString().replace(/[^0-9]/g, '');
            const searchAmount = amount.toString().replace(/[^0-9]/g, '');
            return trxAmount === searchAmount;
        });

        return res.json({
            status: matchingTransaction ? "success" : "pending"
        });

    } catch (error) {
        console.error('Error checking QRIS status:', error);
        return res.json({
            status: "pending"
        });
    }
});

// Error handling untuk 404
app.use((req, res, next) => {
    res.status(404).json({
        status: false,
        creator: "AbiDev",
        message: "Endpoint tidak ditemukan"
    });
});

// Error handling untuk error lainnya
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        status: false,
        creator: "AbiDev",
        message: "Terjadi kesalahan pada server"
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});

module.exports = app;