require('dotenv').config();
const { createCache, fetchJson } = require('./lib/requests');
const cached = createCache();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');


// ===== CONFIG =====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY;
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ===== SLASH COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('help').setDescription('วิธีใช้และรายการคำสั่งทั้งหมด'),
  new SlashCommandBuilder().setName('unwatch').setDescription('ลบหุ้นออกจาก watchlist')
    .addStringOption(o => o.setName('ticker').setDescription('ชื่อหุ้น เช่น AAPL').setRequired(true)),
  new SlashCommandBuilder()
    .setName('news')
    .setDescription('ดูข่าวหุ้นล่าสุด + วิเคราะห์ด้วย AI')
    .addStringOption(o => o.setName('ticker').setDescription('ชื่อหุ้น เช่น AAPL, NVDA').setRequired(true)),

  new SlashCommandBuilder()
    .setName('price')
    .setDescription('ดูราคาหุ้นปัจจุบัน')
    .addStringOption(o => o.setName('ticker').setDescription('ชื่อหุ้น เช่น AAPL, TSLA').setRequired(true)),

  new SlashCommandBuilder()
    .setName('analyze')
    .setDescription('วิเคราะห์หุ้นแบบลึก (AI)')
    .addStringOption(o => o.setName('ticker').setDescription('ชื่อหุ้น').setRequired(true))
    .addStringOption(o => o.setName('question').setDescription('คำถามเพิ่มเติม (ไม่บังคับ)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('ดูหุ้นทั้งหมดใน watchlist ของเซิร์ฟเวอร์นี้'),

  new SlashCommandBuilder()
    .setName('watch')
    .setDescription('เพิ่มหุ้นเข้า watchlist')
    .addStringOption(o => o.setName('ticker').setDescription('ชื่อหุ้น').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setnews')
    .setDescription('ตั้ง channel สำหรับรับข่าวหุ้นสหรัฐอัตโนมัติ (ทุก 5 นาที)')
    .addChannelOption(o => o.setName('channel').setDescription('channel ที่จะส่งข่าว').setRequired(true)),

  new SlashCommandBuilder()
    .setName('stopnews')
    .setDescription('หยุดส่งข่าวอัตโนมัติในเซิร์ฟเวอร์นี้'),

  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('สร้าง Dashboard หุ้นน่าจับตามองในช่องที่เลือก (อัปเดตทุก 1 นาที)')
    .addChannelOption(o => o.setName('channel').setDescription('ช่องสำหรับแสดง Dashboard').setRequired(true)),

  new SlashCommandBuilder()
    .setName('stopdashboard')
    .setDescription('หยุดและลบ Dashboard หุ้นน่าจับตามอง'),
];

// ===== REGISTER COMMANDS =====
async function registerCommands(guildId = null) {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    if (guildId) {
      console.log(`📡 กำลัง register slash commands สำหรับเซิร์ฟเวอร์ ${guildId}...`);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands.map(c => c.toJSON()) });
    } else {
      console.log('📡 กำลัง register slash commands ทั่วไป (Global)...');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands.map(c => c.toJSON()) });
    }
    console.log('✅ Register commands สำเร็จ!');
  } catch (err) {
    console.error(`❌ Register commands ล้มเหลว (${guildId ? 'Guild' : 'Global'}):`, err.message);
  }
}

// ===== FINNHUB API =====
async function getStockPrice(ticker) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`;
  const data = await cached(`quote:${ticker}`, 15_000, () => fetchJson(url));
  if (!data.c || data.c === 0) return null;
  return {
    current: data.c,
    change: data.d,
    changePct: data.dp,
    high: data.h,
    low: data.l,
    open: data.o,
    prevClose: data.pc,
  };
}

async function getCompanyNews(ticker) {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(ticker)}&from=${weekAgo}&to=${today}&token=${FINNHUB_KEY}`;
  const data = await cached(`news:${ticker}`, 60_000, () => fetchJson(url));
  return Array.isArray(data) ? data.slice(0, 5) : [];
}

async function getCompanyProfile(ticker) {
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`;
  return cached(`profile:${ticker}`, 86_400_000, () => fetchJson(url));
}

async function getGeneralNews() {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_KEY}`;
  const data = await cached('general-news', 60_000, () => fetchJson(url));
  return Array.isArray(data) ? data.slice(0, 8) : [];
}

// ===== AI SUMMARY FOR AUTO NEWS =====
async function aiSummarizeNews(newsItems) {
  const newsText = newsItems.map((n, i) => `${i + 1}. ${n.headline} (${n.source})`).join('\n');

  const data = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `คุณเป็นนักวิเคราะห์ตลาดหุ้นสหรัฐ สรุปข่าวสำคัญเป็นภาษาไทยกระชับ
จัดเรียงตามความสำคัญ ระบุหุ้นที่เกี่ยวข้อง
ใช้ emoji ให้เหมาะสม ห้ามใช้ markdown bold/italic
สรุปไม่เกิน 800 ตัวอักษร จบด้วยมุมมองภาพรวมตลาดสั้นๆ`
        },
        { role: 'user', content: `สรุปข่าวตลาดหุ้นสหรัฐล่าสุด:\n${newsText}` },
      ],
      temperature: 0.5,
      max_tokens: 800,
    }),
  }, 30_000);
  return data.choices[0].message.content;
}

// ===== AI EXTRACT TRENDING STOCKS =====
async function aiExtractTrendingStocks(newsItems) {
  const newsText = newsItems.map((n, i) => `${i + 1}. ${n.headline} (${n.source})`).join('\n');

  const systemPrompt = `You are a financial analyst specializing in the US stock market.
Analyze the latest market news and select the top 10 most important/trending stocks to watch.
Respond ONLY with a JSON object in this exact format containing exactly 10 stocks in the array, with NO Markdown tags:
{
  "stocks": [
    {"ticker": "NVDA", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "AAPL", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "TSLA", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "LLY", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "XOM", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "MSFT", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "AMZN", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "META", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "GOOGL", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"},
    {"ticker": "BRK.B", "reason": "คำอธิบายเป็นภาษาไทยสั้นๆ กระชับ ห้ามใช้ bold/italic"}
  ],
  "marketOverview": "บทวิเคราะห์หรือมุมมองภาพรวมตลาดสั้นๆ เป็นภาษาไทย กระชับ ไม่เกิน 3 ประโยค ห้ามใช้ bold/italic"
}`;

  const data = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `ข่าวตลาดล่าสุด:\n${newsText}` },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    }),
  }, 30_000);
  const content = data.choices[0].message.content.trim();
  
  try {
    let cleanedContent = content;
    if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.replace(/^```json\s*/, '').replace(/```$/, '');
    }
    return JSON.parse(cleanedContent.trim());
  } catch (e) {
    console.error('❌ Failed to parse AI JSON response:', content);
    throw new Error('AI returned invalid JSON');
  }
}

// ===== AI ANALYSIS (Groq) =====
async function aiAnalyze(ticker, newsItems, priceData, userQuestion = null) {
  const newsText = newsItems.map((n, i) => `${i + 1}. ${n.headline}`).join('\n');
  const priceText = priceData
    ? `ราคาปัจจุบัน: $${priceData.current} (${priceData.changePct > 0 ? '+' : ''}${priceData.changePct?.toFixed(2)}%)`
    : '';

  const systemPrompt = `คุณเป็นนักวิเคราะห์หุ้นผู้เชี่ยวชาญ ตอบเป็นภาษาไทยกระชับชัดเจน
ครอบคลุม: สรุปข่าว, ผลกระทบต่อราคา, ความเสี่ยง/โอกาส, คำแนะนำสั้นๆ
ใช้ emoji ให้เหมาะสม ห้ามใช้ markdown bold/italic เพราะแสดงใน Discord embed`;

  const userPrompt = userQuestion
    ? `หุ้น ${ticker}\n${priceText}\nข่าวล่าสุด:\n${newsText}\n\nคำถาม: ${userQuestion}`
    : `วิเคราะห์หุ้น ${ticker}\n${priceText}\nข่าวล่าสุด:\n${newsText}`;

  const data = await fetchJson('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  }, 30_000);
  return data.choices[0].message.content;
}

// ===== WATCHLIST (in-memory) =====
const watchlists = new Map();

function getWatchlist(guildId) {
  if (!watchlists.has(guildId)) watchlists.set(guildId, new Set());
  return watchlists.get(guildId);
}

// ===== AUTO NEWS =====
const newsChannels = new Map(); // guildId -> channelId
const postedNewsIds = new Set(); // เก็บ ID ข่าวที่โพสต์แล้ว
let autoNewsInterval = null;

async function checkAndPostNews() {
  if (newsChannels.size === 0) return;

  try {
    const news = await getGeneralNews();
    // กรองข่าวที่ยังไม่เคยโพสต์
    const newItems = news.filter(n => !postedNewsIds.has(n.id));
    if (newItems.length === 0) return;

    // จำ ID ข่าวที่โพสต์แล้ว (เก็บแค่ 200 อันล่าสุด)
    newItems.forEach(n => postedNewsIds.add(n.id));
    if (postedNewsIds.size > 200) {
      const arr = [...postedNewsIds];
      arr.slice(0, arr.length - 200).forEach(id => postedNewsIds.delete(id));
    }

    // AI สรุปข่าว
    const summary = await aiSummarizeNews(newItems);

    // สร้าง embed โดยคุมความยาวลิงก์ไม่ให้เกิน 1,000 ตัวอักษร (ป้องกัน Discord error)
    let newsLinks = '';
    for (const n of newItems.slice(0, 3)) { // เอาแค่ 3 ลิงก์ที่สำคัญที่สุด
      const linkLine = `• [${n.headline.slice(0, 75)}${n.headline.length > 75 ? '…' : ''}](${n.url})\n`;
      if (newsLinks.length + linkLine.length < 1000) {
        newsLinks += linkLine;
      } else {
        break;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xf0b232)
      .setTitle('🇺🇸 ข่าวตลาดหุ้นสหรัฐ')
      .setDescription(summary)
      .addFields({ name: '🔗 แหล่งข่าว', value: newsLinks.trim() || 'ไม่มีลิงก์' })
      .setFooter({ text: 'อัปเดตทุก 5 นาที • Powered by Finnhub + Groq AI' })
      .setTimestamp();

    // ส่งไปทุก channel ที่ตั้งไว้
    for (const [guildId, channelId] of newsChannels) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel) await channel.send({ embeds: [embed] });
      } catch (err) {
        console.error(`❌ ส่งข่าวไป guild ${guildId} ไม่สำเร็จ:`, err.message);
      }
    }

    console.log(`📰 ส่งข่าวอัตโนมัติสำเร็จ (${newItems.length} ข่าวใหม่ → ${newsChannels.size} เซิร์ฟเวอร์)`);
  } catch (err) {
    console.error('❌ Auto news error:', err);
  }
}

function startAutoNews() {
  if (autoNewsInterval) return;
  autoNewsInterval = setInterval(checkAndPostNews, 5 * 60 * 1000); // ทุก 5 นาที
  // เช็คครั้งแรกหลัง 10 วินาที
  setTimeout(checkAndPostNews, 10_000);
  console.log('📡 เริ่มระบบข่าวอัตโนมัติ (ทุก 5 นาที)');
}

// ===== LIVE DASHBOARD SYSTEM =====
const dashboardMessages = new Map(); // guildId -> { channelId, messageId }
let trendingStocksCache = null;
let dashboardRefreshInterval = null;
let dashboardAiInterval = null;

async function updateTrendingStocks() {
  try {
    console.log('🔄 AI กำลังอัปเดตหุ้นน่าจับตามองจากข่าวล่าสุด...');
    const news = await getGeneralNews();
    if (!news.length) {
      console.log('⚠️ ไม่พบข่าวตลาดหุ้นเพื่อส่งให้ AI วิเคราะห์');
      return;
    }
    
    const trendingData = await aiExtractTrendingStocks(news);
    if (trendingData && trendingData.stocks && trendingData.stocks.length > 0) {
      trendingStocksCache = {
        stocks: trendingData.stocks,
        marketOverview: trendingData.marketOverview,
        updatedAt: Date.now()
      };
      console.log('✅ อัปเดต Cache หุ้นน่าจับตามองสำเร็จ:', trendingStocksCache.stocks.map(s => s.ticker).join(', '));
    }
  } catch (err) {
    console.error('❌ ไม่สามารถอัปเดตหุ้นน่าจับตามองด้วย AI ได้:', err.message);
  }
}

async function refreshDashboards() {
  if (dashboardMessages.size === 0) return;
  
  // If cache is empty, update it
  if (!trendingStocksCache) {
    await updateTrendingStocks();
  }
  
  if (!trendingStocksCache) {
    console.log('⚠️ ไม่มีข้อมูลใน Cache และอัปเดตไม่สำเร็จ ข้ามการ refresh dashboard');
    return;
  }
  
  // Fetch prices for all tickers in cache
  const stocks = trendingStocksCache.stocks;
  const tickers = stocks.map(s => s.ticker);
  let prices = [];
  try {
    prices = await Promise.all(tickers.map(t => getStockPrice(t).catch(() => null)));
  } catch (err) {
    console.error('❌ Error fetching prices for dashboard:', err.message);
    return;
  }
  
  // Generate embed
  const emojis = ['🔥', '⚡', '🚀', '💊', '⛽', '💎', '🌟', '🛡️', '⚙️', '🌾'];
  const stockLines = [];
  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    const ticker = stock.ticker;
    const reason = stock.reason;
    const emoji = emojis[i] || '📈';
    const price = prices[i];
    
    if (price) {
      const pct = price.changePct || 0;
      const arrow = pct >= 0 ? '📈' : '📉';
      const sign = pct >= 0 ? '+' : '';
      stockLines.push(`${emoji} **${ticker}** | \`$${price.current.toFixed(2)}\` | ${arrow} \`${sign}${pct.toFixed(2)}%\`\n └ *${reason}*`);
    } else {
      stockLines.push(`${emoji} **${ticker}** | \`N/A\`\n └ *${reason}*`);
    }
  }
  const stocksText = stockLines.join('\n\n');
  
  const timeString = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok' });
  const embed = new EmbedBuilder()
    .setColor(0x00ffd2)
    .setTitle('📊 หุ้นน่าจับตามอง (Live Dashboard)')
    .setDescription(stocksText)
    .addFields(
      { name: '🤖 บทวิเคราะห์ภาพรวมตลาดจาก AI', value: trendingStocksCache.marketOverview || 'ไม่มีข้อมูลวิเคราะห์' }
    )
    .setFooter({ text: `อัปเดตทุก 1 นาที • ข้อมูลล่าสุด ณ ${timeString} • Powered by Groq AI` })
    .setTimestamp();

  for (const [guildId, info] of dashboardMessages) {
    try {
      const channel = await client.channels.fetch(info.channelId);
      if (!channel) continue;
      
      const message = await channel.messages.fetch(info.messageId);
      if (message) {
        await message.edit({ content: null, embeds: [embed] });
      }
    } catch (err) {
      console.error(`❌ แก้ไข Dashboard สำหรับ guild ${guildId} ไม่สำเร็จ:`, err.message);
      // If message was deleted by user, remove it from Map
      if (err.code === 10008 || err.code === 50083) {
        dashboardMessages.delete(guildId);
      }
    }
  }
  console.log(`🔄 อัปเดตราคา Dashboard สำเร็จ ณ เวลา ${timeString}`);
}

async function startDashboardLoops() {
  if (dashboardRefreshInterval || dashboardAiInterval) return;
  
  // First, do a cache check and update if needed
  if (!trendingStocksCache) {
    await updateTrendingStocks();
  }
  
  dashboardRefreshInterval = setInterval(refreshDashboards, 1 * 60 * 1000);
  dashboardAiInterval = setInterval(updateTrendingStocks, 5 * 60 * 1000);
  console.log('📡 เริ่มระบบ Dashboard loops (Refresh ทุก 1 นาที, AI ทุก 5 นาที)');
}

function stopDashboardLoops() {
  if (dashboardRefreshInterval) {
    clearInterval(dashboardRefreshInterval);
    dashboardRefreshInterval = null;
  }
  if (dashboardAiInterval) {
    clearInterval(dashboardAiInterval);
    dashboardAiInterval = null;
  }
  console.log('⏹️ หยุดระบบ Dashboard loops (ไม่มีเซิร์ฟเวอร์เปิดใช้งาน)');
}

// ===== COLOR HELPER =====
function priceColor(changePct) {
  if (!changePct) return 0x888888;
  return changePct >= 0 ? 0x3ba55d : 0xed4245;
}

// ===== COMMAND HANDLERS =====
async function handleNews(interaction) {
  const ticker = interaction.options.getString('ticker').trim().toUpperCase();
  await interaction.deferReply();

  try {
    const [news, price, profile] = await Promise.all([
      getCompanyNews(ticker),
      getStockPrice(ticker),
      getCompanyProfile(ticker).catch(() => null),
    ]);

    if (!news.length && !price) {
      return interaction.editReply(`❌ ไม่พบข้อมูลสำหรับ **${ticker}** — ตรวจสอบชื่อหุ้นอีกครั้ง`);
    }

    const pct = price?.changePct;
    const arrow = pct >= 0 ? '📈' : '📉';

    const embed = new EmbedBuilder()
      .setColor(priceColor(pct))
      .setTitle(`${arrow} ${ticker} ${profile?.name ? `— ${profile.name}` : ''}`)
      .setDescription('⏳ กำลังวิเคราะห์ด้วย AI — อ่านข่าวและราคาด้านล่างได้เลย')
      .setTimestamp();

    if (price) {
      embed.addFields(
        { name: '💵 ราคา', value: `$${price.current}`, inline: true },
        { name: '📊 เปลี่ยนแปลง', value: `${pct >= 0 ? '+' : ''}${pct?.toFixed(2)}%`, inline: true },
        { name: '📅 High/Low', value: `$${price.high} / $${price.low}`, inline: true }
      );
    }

    if (news.length) {
      const newsField = news.slice(0, 4).map(n =>
        `• [${n.headline.slice(0, 70)}${n.headline.length > 70 ? '…' : ''}](${n.url})`
      ).join('\n');
      embed.addFields({ name: '📰 ข่าวล่าสุด', value: newsField.slice(0, 1024) || 'ไม่มีข่าว' });
    }

    await interaction.editReply({ embeds: [embed] });
    try {
      const aiText = await aiAnalyze(ticker, news, price);
      embed.setDescription(aiText.slice(0, 4000));
    } catch (err) {
      console.error('AI analysis failed:', err.message);
      embed.setDescription('⚠️ AI ยังไม่พร้อมใช้งาน ข้อมูลข่าวและราคายังคงดูได้ กรุณาลอง /analyze อีกครั้งภายหลัง');
    }
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply('❌ เกิดข้อผิดพลาด กรุณาลองใหม่');
  }
}

async function handlePrice(interaction) {
  const ticker = interaction.options.getString('ticker').trim().toUpperCase();
  await interaction.deferReply();

  try {
    const [price, profile] = await Promise.all([getStockPrice(ticker), getCompanyProfile(ticker).catch(() => null)]);
    if (!price) return interaction.editReply(`❌ ไม่พบราคาสำหรับ **${ticker}**`);

    const pct = price.changePct;
    const embed = new EmbedBuilder()
      .setColor(priceColor(pct))
      .setTitle(`${pct >= 0 ? '📈' : '📉'} ${ticker} ${profile?.name ? `— ${profile.name}` : ''}`)
      .addFields(
        { name: '💵 ราคาปัจจุบัน', value: `**$${price.current}**`, inline: true },
        { name: '🔄 เปลี่ยนแปลง', value: `${pct >= 0 ? '+' : ''}${pct?.toFixed(2)}% ($${price.change?.toFixed(2)})`, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '🔼 High', value: `$${price.high}`, inline: true },
        { name: '🔽 Low', value: `$${price.low}`, inline: true },
        { name: '📌 Prev Close', value: `$${price.prevClose}`, inline: true }
      )
      .setFooter({ text: 'ข้อมูลจาก Finnhub • แคชราคาไม่เกิน 15 วินาที' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply('❌ เกิดข้อผิดพลาด');
  }
}

async function handleAnalyze(interaction) {
  const ticker = interaction.options.getString('ticker').trim().toUpperCase();
  const question = interaction.options.getString('question');
  await interaction.deferReply();

  try {
    const [news, price] = await Promise.all([getCompanyNews(ticker), getStockPrice(ticker)]);
    const aiText = await aiAnalyze(ticker, news, price, question);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🤖 AI วิเคราะห์ — ${ticker}`)
      .setDescription(aiText.slice(0, 4000))
      .setTimestamp()
      .setFooter({ text: 'Powered by Groq AI' });

    if (question) embed.addFields({ name: '❓ คำถาม', value: question.slice(0, 1024) });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply('❌ เกิดข้อผิดพลาด');
  }
}

async function handleWatch(interaction) {
  const ticker = interaction.options.getString('ticker').trim().toUpperCase();
  const list = getWatchlist(interaction.guildId);
  if (list.has(ticker)) return interaction.reply({ content: 'ℹ️ มีหุ้นนี้ใน watchlist แล้ว', ephemeral: true });
  if (list.size >= 25) return interaction.reply({ content: '📋 Watchlist เต็ม (25 ตัว) ใช้ /unwatch เพื่อลบหุ้นก่อน', ephemeral: true });
  list.add(ticker);
  await interaction.reply(`✅ เพิ่ม **${ticker}** เข้า watchlist แล้ว (มีทั้งหมด ${list.size} ตัว)`);
}

async function handleWatchlist(interaction) {
  const list = getWatchlist(interaction.guildId);
  await interaction.deferReply();

  if (!list.size) return interaction.editReply('📋 Watchlist ว่างอยู่ ลอง `/watch AAPL` เพื่อเพิ่มหุ้น');

  const tickers = [...list];
  const prices = await Promise.all(tickers.map(t => getStockPrice(t).catch(() => null)));

  const rows = tickers.map((t, i) => {
    const p = prices[i];
    if (!p) return `• **${t}** — ไม่พบข้อมูล`;
    const sign = p.changePct >= 0 ? '📈 +' : '📉 ';
    return `• **${t}** $${p.current}  ${sign}${p.changePct?.toFixed(2)}%`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Watchlist ของเซิร์ฟเวอร์นี้')
    .setDescription(rows)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

// ===== SETNEWS / STOPNEWS HANDLERS =====
async function handleSetNews(interaction) {
  const channel = interaction.options.getChannel('channel');
  if (!channel || !channel.isTextBased()) {
    return interaction.reply({ content: '❌ กรุณาเลือก text channel', ephemeral: true });
  }
  newsChannels.set(interaction.guildId, channel.id);
  
  // ล้างประวัติการส่งข่าว เพื่อให้ส่งข่าวล่าสุด 8 อันปัจจุบันเข้าห้องใหม่ทันทีเพื่อทดสอบการทำงาน
  postedNewsIds.clear();
  
  startAutoNews();
  await interaction.reply(`✅ ตั้งข่าวอัตโนมัติไปที่ <#${channel.id}> แล้ว\n📡 จะส่งข่าวตลาดสหรัฐทุก 5 นาที (ข่าวแรกจะมาประมาณ ~10 วินาที)`);
}

async function handleStopNews(interaction) {
  if (!newsChannels.has(interaction.guildId)) {
    return interaction.reply({ content: '❌ เซิร์ฟเวอร์นี้ยังไม่ได้ตั้งข่าวอัตโนมัติ', ephemeral: true });
  }
  newsChannels.delete(interaction.guildId);
  if (newsChannels.size === 0 && autoNewsInterval) {
    clearInterval(autoNewsInterval);
    autoNewsInterval = null;
    console.log('⏹️ หยุดระบบข่าวอัตโนมัติ (ไม่มีเซิร์ฟเวอร์ใช้งาน)');
  }
  await interaction.reply('⏹️ หยุดส่งข่าวอัตโนมัติแล้ว');
}

// ===== DASHBOARD HANDLERS =====
async function handleDashboard(interaction) {
  const channel = interaction.options.getChannel('channel');
  if (!channel || !channel.isTextBased()) {
    return interaction.reply({ content: '❌ กรุณาเลือก text channel', ephemeral: true });
  }
  
  await interaction.deferReply({ ephemeral: true });
  
  // If there's an existing dashboard in this guild, try to delete it
  if (dashboardMessages.has(interaction.guildId)) {
    const oldInfo = dashboardMessages.get(interaction.guildId);
    try {
      const oldChannel = await client.channels.fetch(oldInfo.channelId);
      if (oldChannel) {
        const oldMsg = await oldChannel.messages.fetch(oldInfo.messageId);
        if (oldMsg) await oldMsg.delete();
      }
    } catch (err) {
      console.log('ℹ️ ไม่สามารถลบ Dashboard เก่าได้ (อาจถูกลบไปแล้ว):', err.message);
    }
  }
  
  // Send loading message to target channel
  let loadingMsg;
  try {
    loadingMsg = await channel.send({ content: '⏳ กำลังวิเคราะห์ข้อมูลตลาดและจัดเตรียม Dashboard...' });
  } catch (err) {
    return interaction.editReply(`❌ บอทไม่มีสิทธิ์ส่งข้อความในช่อง <#${channel.id}>`);
  }
  
  // Save message info
  dashboardMessages.set(interaction.guildId, {
    channelId: channel.id,
    messageId: loadingMsg.id
  });
  
  // Start intervals if this is the first dashboard
  await startDashboardLoops();
  
  // Force an immediate refresh for this guild so the loading message changes to the dashboard immediately
  await refreshDashboards();
  
  await interaction.editReply(`✅ ตั้งค่า Dashboard สำเร็จในช่อง <#${channel.id}>`);
}

async function handleStopDashboard(interaction) {
  if (!dashboardMessages.has(interaction.guildId)) {
    return interaction.reply({ content: '❌ เซิร์ฟเวอร์นี้ยังไม่ได้สร้าง Dashboard', ephemeral: true });
  }
  
  await interaction.deferReply({ ephemeral: true });
  
  const info = dashboardMessages.get(interaction.guildId);
  try {
    const channel = await client.channels.fetch(info.channelId);
    if (channel) {
      const msg = await channel.messages.fetch(info.messageId);
      if (msg) await msg.delete();
    }
  } catch (err) {
    console.log('ℹ️ ไม่สามารถลบข้อความ Dashboard ได้ (อาจถูกลบไปแล้ว):', err.message);
  }
  
  dashboardMessages.delete(interaction.guildId);
  
  if (dashboardMessages.size === 0) {
    stopDashboardLoops();
  }
  
  await interaction.editReply('⏹️ หยุดและลบ Dashboard แล้ว');
}

// ===== EVENT HANDLERS =====
client.once('ready', async () => {
  console.log(`✅ Bot พร้อมใช้งานในชื่อ ${client.user.tag}`);
  
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  
  try {
    // ลบคำสั่งแบบ Global ออกให้หมด เพื่อแก้ปัญหาคำสั่งซ้ำ
    console.log('🧹 กำลังเคลียร์คำสั่งแบบ Global เก่าออก...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    console.log('✅ เคลียร์คำสั่ง Global สำเร็จ!');
  } catch (err) {
    console.error('❌ ไม่สามารถเคลียร์คำสั่ง Global ได้:', err.message);
  }

  // ลงทะเบียนคำสั่งกับทุกเซิร์ฟเวอร์ที่บอทอยู่ ณ ตอนเปิด เพื่อให้แสดงผลทันทีไม่ต้องรอ cache
  const guilds = [...client.guilds.cache.keys()];
  console.log(`🤖 พบเซิร์ฟเวอร์ที่บอทอยู่ทั้งหมด ${guilds.length} เซิร์ฟเวอร์`);
  for (const guildId of guilds) {
    await registerCommands(guildId);
  }
});

async function handleUnwatch(interaction) {
  const ticker = interaction.options.getString('ticker').trim().toUpperCase();
  const removed = getWatchlist(interaction.guildId).delete(ticker);
  await interaction.reply({ content: removed ? '✅ ลบ **' + ticker + '** ออกจาก watchlist แล้ว' : 'ℹ️ ไม่มีหุ้นนี้ใน watchlist', ephemeral: true });
}

async function handleHelp(interaction) {
  await interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder()
    .setColor(0x5865f2).setTitle('📚 คู่มือ Stock Bot')
    .setDescription(commands.map(c => '/' + c.name + ' — ' + c.description).join('\n'))
    .setFooter({ text: 'ตัวอย่าง: /price ticker:AAPL • Watchlist สูงสุด 25 ตัว และจะรีเซ็ตเมื่อบอตรีสตาร์ต' })] });
}

const handlers = { news: handleNews, price: handlePrice, analyze: handleAnalyze,
  watch: handleWatch, unwatch: handleUnwatch, watchlist: handleWatchlist,
  help: handleHelp, setnews: handleSetNews, stopnews: handleStopNews,
  dashboard: handleDashboard, stopdashboard: handleStopDashboard };

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (!interaction.guildId) return await interaction.reply({ content: 'กรุณาใช้คำสั่งในเซิร์ฟเวอร์', ephemeral: true });
    const ticker = interaction.options.getString('ticker');
    if (ticker !== null && !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker.trim().toUpperCase())) {
      return await interaction.reply({ content: '❌ รูปแบบชื่อหุ้นไม่ถูกต้อง เช่น AAPL, NVDA หรือ BRK.B', ephemeral: true });
    }
    const handler = handlers[interaction.commandName];
    if (handler) await handler(interaction);
  } catch (err) {
    console.error('Command failed:', err.message);
    const content = '❌ ทำรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
      else await interaction.reply({ content, ephemeral: true });
    } catch (replyError) { console.error('Cannot reply:', replyError.message); }
  }
}
client.on('interactionCreate', handleInteraction);
client.on('guildCreate', guild => registerCommands(guild.id));

// ===== START =====
if (require.main === module) {
  client.login(DISCORD_TOKEN).catch(err => {
    console.error('Login failed:', err.message);
    process.exitCode = 1;
  });
}
module.exports = { handleInteraction, handleNews, getStockPrice, commands };