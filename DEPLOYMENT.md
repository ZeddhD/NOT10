# NOT10 - Deployment Guide

> **Step-by-step instructions to deploy your own NOT10 multiplayer game**

This guide will walk you through setting up and deploying NOT10, from local development to production hosting.

---

## 🎯 Deployment Options

Choose your path:

| Option | Setup Time | Cost | Best For |
|--------|-----------|------|----------|
| **AI Mode Only** | 0 minutes | Free | Instant play, no setup |
| **Local Multiplayer** | 10 minutes | Free | Testing with friends locally |
| **Production Deploy** | 20 minutes | Free tier available | Public hosting |

---

## ⚡ Option 1: AI Mode (No Setup Required)

**Play immediately with zero configuration!**

1. Open `index.html` in any modern browser
2. Click **"Play vs AI"** from the main menu
3. Start playing against 3 AI opponents

✅ No internet connection required  
✅ No database setup needed  
✅ Works completely offline

---

## 🏠 Option 2: Local Multiplayer Setup

**Set up full multiplayer on your local network (10 minutes)**

### Step 1: Create Supabase Account

1. Go to [supabase.com](https://supabase.com)
2. Click **"Start your project"**
3. Sign up with GitHub, Google, or email
4. Create a new organization (free tier is fine)

### Step 2: Create New Project

1. Click **"New Project"**
2. Fill in project details:
   - **Name**: `NOT10` (or any name you like)
   - **Database Password**: Choose a strong password (save it!)
   - **Region**: Select closest to your location
   - **Pricing Plan**: Free tier works perfectly
3. Click **"Create new project"**
4. ⏱️ Wait 2-3 minutes for project provisioning

### Step 3: Set Up Database

1. In your Supabase dashboard, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Open `supabase/schema.sql` from your NOT10 folder
4. Copy ALL the content and paste into the SQL editor
5. Click **"Run"** (or press Ctrl+Enter)
6. ✅ You should see "Success. No rows returned"

7. Click **"New query"** again
8. Open `supabase/rls.sql` from your NOT10 folder  
9. Copy ALL the content and paste into the SQL editor
10. Click **"Run"**
11. ✅ You should see success messages

### Step 4: Get Your Credentials

1. Click **"Settings"** in the sidebar (gear icon)
2. Click **"API"** under Project Settings
3. Find and copy two values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon/public key** (long string starting with `eyJ...`)

### Step 5: Configure the App

1. In your NOT10 folder, navigate to `assets/js/`
2. Copy `config.example.js` and rename it to `config.js`
   ```bash
   # Windows PowerShell
   Copy-Item assets/js/config.example.js assets/js/config.js
   
   # Mac/Linux Terminal  
   cp assets/js/config.example.js assets/js/config.js
   ```
3. Open `config.js` in any text editor
4. Replace the placeholder values:
   ```javascript
   export const config = {
       supabaseUrl: 'https://your-project.supabase.co',     // ← Paste your URL
       supabaseAnonKey: 'your-anon-key-here',               // ← Paste your key
       debug: false
   };
   ```
5. Save the file

### Step 6: Run Locally

Choose one method:

#### Method A: VS Code Live Server (Recommended)
1. Install **"Live Server"** extension in VS Code
2. Right-click `index.html` → **"Open with Live Server"**
3. Game opens at `http://localhost:5500`

#### Method B: Python HTTP Server
```bash
# Python 3
python -m http.server 8000

# Then open http://localhost:8000 in your browser
```

#### Method C: Node.js HTTP Server
```bash
# Install http-server globally (one-time)
npm install -g http-server

# Run server
http-server

# Then open http://localhost:8080
```

### Step 7: Test Multiplayer

1. Open the game in your browser
2. Click **"Create Lobby"**
3. Note the 4-character room code
4. Open a new browser tab/window (or use another device on same network)
5. Click **"Join Lobby"** and enter the room code
6. Both players click **"Ready"**
7. Host clicks **"Start Game"**
8. 🎉 You're playing multiplayer!

---

## 🌐 Option 3: Production Deployment

**Deploy to the internet for anyone to access (20 minutes)**

### Prerequisites
- Completed Steps 1-5 from Local Setup above
- GitHub account (for GitHub Pages or Vercel)

---

### Deployment Platform A: GitHub Pages (Easiest)

1. **Create GitHub Repository**
   ```bash
   # In your NOT10 folder
   git init
   git add .
   git commit -m "Initial commit: NOT10 game"
   ```

2. **Create repo on GitHub**
   - Go to [github.com/new](https://github.com/new)
   - Repository name: `NOT10`
   - Make it Public or Private (Pages works with both)
   - Don't initialize with README (you already have files)
   - Click **"Create repository"**

3. **Push your code**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/NOT10.git
   git branch -M main
   git push -u origin main
   ```

4. **Enable GitHub Pages**
   - Go to repository **Settings** → **Pages**
   - Under **Source**, select `main` branch
   - Click **Save**
   - Wait 1-2 minutes

5. **Access your game**
   - URL: `https://YOUR_USERNAME.github.io/NOT10/`
   - Share this URL with friends!

⚠️ **Important**: Your `config.js` file with credentials will be public. For production, use environment variables or Supabase Row Level Security.

---

### Deployment Platform B: Vercel (Automatic Deployments)

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Deploy**
   ```bash
   # In your NOT10 folder
   vercel
   ```

3. **Follow prompts**
   - Login to Vercel (creates account if needed)
   - Set up and deploy? **Y**
   - Scope: Select your account
   - Link to existing project? **N**
   - Project name: `NOT10`
   - Directory: **.**  (current directory)
   - Override settings? **N**

4. **Access your game**
   - Vercel provides a URL like `not10-xxx.vercel.app`
   - Share with friends!

5. **Continuous Deployment (Optional)**
   ```bash
   # Push to GitHub
   git push origin main
   
   # Vercel auto-deploys on every push
   ```

---

### Deployment Platform C: Netlify (Drag & Drop)

1. **Prepare deployment folder**
   - Make sure `config.js` exists with your credentials
   - Ensure all files are saved

2. **Deploy**
   - Go to [netlify.com/drop](https://app.netlify.com/drop)
   - Drag and drop your entire `NOT10` folder
   - Wait for upload and deployment

3. **Access your game**
   - Netlify provides a URL like `random-name-12345.netlify.app`
   - You can customize the subdomain in site settings

4. **Update deployment**
   - Make changes to your files
   - Drag and drop folder again to update

---

## 🔒 Production Security Best Practices

### Protect Your Credentials

**Option 1: Environment Variables (Recommended)**

For Vercel:
```bash
# Add environment variables
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY

# Redeploy
vercel --prod
```

Update your config loading in `app.js`:
```javascript
const supabaseUrl = import.meta.env.SUPABASE_URL || config.supabaseUrl;
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY || config.supabaseAnonKey;
```

**Option 2: Use RLS Properly**

Your anon key is meant to be public - Supabase RLS policies protect your data:
- ✅ Players can only see their own hand cards
- ✅ Bots are controlled by host only  
- ✅ Room data is accessible but not modifiable by non-hosts

**Option 3: Private Repository**

If using GitHub Pages:
- Keep repository private
- Only share the deployed URL, not the repo

---

## 🧪 Testing Your Deployment

### Checklist Before Going Live

- [ ] AI Mode works (no Supabase needed)
- [ ] Can create lobby and get room code
- [ ] Can join lobby with room code
- [ ] Can see other players join
- [ ] Ready button works for all players
- [ ] Game starts and cards deal
- [ ] Betting phase works correctly
- [ ] Card playing works correctly
- [ ] Round ends and pot distributes
- [ ] New rounds start automatically
- [ ] Game over shows winner
- [ ] Bot auto-fill works (test with 2-3 players)
- [ ] Bots make moves automatically
- [ ] Reconnect works after page refresh

### Test Multiplayer with Multiple Devices

1. **Open on phone** - Join with room code
2. **Open on tablet** - Join same room
3. **Open incognito window** - Test 4th player
4. Verify all actions sync in real-time

---

## 📊 Monitor Your Deployment

### Supabase Dashboard

Track your game's usage:
1. Go to Supabase dashboard
2. Click **"Database"** → **"Tables"**
3. View active rooms, players, games

### Check Table Sizes
```sql
-- Run in SQL Editor
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Free Tier Limits (Supabase)
- 500 MB database size
- 2 GB bandwidth per month  
- 50 MB file storage
- Realtime: 200 concurrent connections

NOT10 is very lightweight - free tier handles thousands of games!

---

## 🛠️ Troubleshooting Deployment

| Issue | Solution |
|-------|----------|
| **"Supabase Not Configured" error** | Ensure `config.js` exists with correct credentials |
| **CORS errors in browser console** | Make sure you're using a proper HTTP server, not `file://` protocol |
| **Changes not showing after deploy** | Clear browser cache (Ctrl+Shift+R) or use incognito mode |
| **GitHub Pages 404 error** | Check Pages settings; ensure `index.html` is in root |
| **Database errors** | Verify both SQL scripts ran successfully in Supabase |
| **Realtime not working** | Check Supabase project is on Free tier or higher |
| **Bots not making moves** | Check browser console for errors; ensure host stays connected |

---

## 🎯 Quick Reference

### Important Files
```
config.js              ← Your Supabase credentials (don't commit to public repos!)
index.html             ← Entry point
supabase/schema.sql    ← Create these tables in Supabase first
supabase/rls.sql       ← Apply these security policies second
```

### Important URLs
- **Supabase Dashboard**: https://supabase.com/dashboard
- **Supabase Docs**: https://supabase.com/docs
- **GitHub Pages**: https://pages.github.com
- **Vercel**: https://vercel.com
- **Netlify**: https://netlify.com

---

## 🚀 You're Ready!

Your NOT10 game is now deployed and ready for multiplayer gaming!

Share your room codes with friends and enjoy playing!

For gameplay instructions and features, see [README.md](README.md)

---

**Happy deploying! 🎮**
