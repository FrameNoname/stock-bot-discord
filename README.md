# 🤖 Stock News Discord Bot

บอท Discord ติดตามข่าวหุ้น real-time วิเคราะห์ด้วย Groq AI (Llama 3.3) พูดภาษาไทย

## คำสั่งที่ใช้ได้

| คำสั่ง | ตัวอย่าง | คำอธิบาย |
|--------|----------|-----------|
| `/news` | `/news NVDA` | ข่าวล่าสุด 5 ข่าว + AI วิเคราะห์ |
| `/price` | `/price AAPL` | ราคาปัจจุบัน, high/low, เปอร์เซ็นต์เปลี่ยน |
| `/analyze` | `/analyze TSLA question:ควรซื้อไหม` | AI วิเคราะห์เชิงลึก + ตอบคำถาม |
| `/watch` | `/watch MSFT` | เพิ่มหุ้นเข้า watchlist ของเซิร์ฟเวอร์ |
| `/watchlist` | `/watchlist` | ดูราคาหุ้นทุกตัวใน watchlist |
| `/setnews` | `/setnews #news-channel` | ตั้งช่องทางส่งสรุปข่าวด่วนสหรัฐอัตโนมัติ (ทุก 5 นาที) |
| `/stopnews` | `/stopnews` | หยุดส่งข่าวหุ้นสหรัฐอัตโนมัติในเซิร์ฟเวอร์นี้ |
| `/dashboard` | `/dashboard #dashboard-channel` | สร้าง Dashboard หุ้นน่าจับตามองในช่องที่เลือก (อัปเดตทุก 1 นาที) |
| `/stopdashboard` | `/stopdashboard` | หยุดและลบ Dashboard หุ้นน่าจับตามอง |

---

## วิธีติดตั้ง

### 1. สร้าง Discord Bot

1. ไปที่ https://discord.com/developers/applications
2. กด **New Application** ตั้งชื่อบอท
3. ไปที่แท็บ **Bot** → กด **Reset Token** → คัดลอก Token
4. เปิด **Message Content Intent** และ **Server Members Intent**
5. ไปที่ **OAuth2 → URL Generator**:
   - Scopes: เลือก `bot` และ `applications.commands`
   - Bot Permissions: เลือก `Send Messages`, `Embed Links`, `Read Message History`
6. คัดลอก URL ที่ได้ → เปิดใน browser → เพิ่มบอทเข้าเซิร์ฟเวอร์

### 2. รับ API Keys

**Finnhub** (ข่าวและราคาหุ้น — ฟรี):
1. สมัครที่ https://finnhub.io
2. ไปที่ Dashboard → คัดลอก API Key

**Groq** (AI ประมวลผลและสรุปข่าวสาร — ฟรี):
1. สมัครที่ https://console.groq.com
2. ไปที่แท็บ **API Keys** → กด **Create API Key** → คัดลอก Key

### 3. ติดตั้งและรัน

```bash
# Clone หรือดาวน์โหลดไฟล์
cd stock-bot

# ติดตั้ง dependencies
npm install

# สร้างไฟล์ .env
cp .env.example .env

# แก้ไข .env ใส่ API keys ทั้งหมด
nano .env   # หรือ code .env

# รันบอท
npm start
```

### 4. หา Application ID (CLIENT_ID)

ไปที่ Discord Developer Portal → เลือก Application → แท็บ **General Information** → คัดลอก **Application ID**

---

## โครงสร้างไฟล์

```
stock-bot/
├── bot.js          ← โค้ดหลักทั้งหมด
├── package.json
├── .env.example    ← template สำหรับ env vars
└── .env            ← ใส่ API keys จริง (ห้าม commit!)
```

---

## Deploy บน Server (Production)

### ใช้ PM2 (แนะนำ)
```bash
npm install -g pm2
pm2 start bot.js --name stock-bot
pm2 save
pm2 startup
```

### ใช้ Railway.app (ฟรี)
1. Push โค้ดขึ้น GitHub
2. สร้าง project ใหม่บน https://railway.app
3. เชื่อมกับ repo → เพิ่ม Environment Variables ทั้ง 4 ตัว
4. Deploy!

### ใช้ Fly.io หรือ Render.com
ทั้งสองรองรับ Node.js ฟรี ดู docs ของแต่ละแพลตฟอร์ม

---

## ขยายฟีเจอร์ (Ideas)

- **Price alert**: แจ้งเมื่อราคาเกิน/ต่ำกว่าที่กำหนด
- **หุ้นไทย SET**: ใช้ Investing.com API หรือ settrade API
- **Database**: เปลี่ยน watchlist จาก in-memory เป็น SQLite/PostgreSQL
- **Sentiment score**: แสดงกราฟ sentiment รายสัปดาห์
