const admin = require('firebase-admin');

// Initialisation Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const ADMIN_TG_TOKEN = process.env.ADMIN_TG_TOKEN;
const ADMIN_TG_CHAT  = process.env.ADMIN_TG_CHAT;

async function sendTelegram(text) {
  const fetch = (await import('node-fetch')).default;
  const r = await fetch(`https://api.telegram.org/bot${ADMIN_TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: ADMIN_TG_CHAT, text, parse_mode: 'HTML' })
  });
  const d = await r.json();
  if (!d.ok) console.error('Telegram error:', d.description);
  else console.log('Message envoyé !');
}

async function main() {
  const today = new Date().toISOString().split('T')[0]; // "2025-05-15"
  const now   = new Date();

  console.log(`Récap du ${today}...`);

  // ── 1. Compter les alertes du jour ──
  const alertesSnap = await db.collection('alertes')
    .where('date', '==', today)
    .get();

  const alertes = alertesSnap.docs.map(d => d.data());
  const nbAlertes = alertes.length;

  // Espèces les plus alertées aujourd'hui
  const especesCount = {};
  alertes.forEach(a => {
    (a.especes || []).forEach(e => {
      especesCount[e] = (especesCount[e] || 0) + 1;
    });
  });
  const topEspeces = Object.entries(especesCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([nom, nb]) => `${nom} (${nb}x)`);

  // Zones les plus actives
  const zonesCount = {};
  alertes.forEach(a => {
    if (a.zone) zonesCount[a.zone] = (zonesCount[a.zone] || 0) + 1;
  });
  const topZones = Object.entries(zonesCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([zone, nb]) => `${zone} (${nb}x)`);

  // Utilisateurs uniques ayant reçu une alerte
  const usersAlertes = new Set(alertes.map(a => a.userId)).size;

  // ── 2. Compter les connexions du jour ──
  // On utilise la collection alertes + retours pour estimer
  // Firebase Auth ne permet pas de filtrer par date côté Admin SDK facilement
  // On compte les users actifs via les alertes du jour
  const usersActifs = new Set([
    ...alertes.map(a => a.userId)
  ]).size;

  // ── 3. Compter les retours du jour ──
  const retoursSnap = await db.collection('retours')
    .where('date', '==', today)
    .get();
  const nbRetours = retoursSnap.size;
  const retours = retoursSnap.docs.map(d => d.data());
  const typesRetours = {};
  retours.forEach(r => {
    typesRetours[r.type] = (typesRetours[r.type] || 0) + 1;
  });

  // ── 4. Compter les nouveaux comptes du jour ──
  // Via Firebase Auth — liste tous les users et filtre par date
  let nbNouveauxComptes = 0;
  try {
    const listResult = await admin.auth().listUsers(1000);
    nbNouveauxComptes = listResult.users.filter(u => {
      const created = u.metadata.creationTime;
      return created && created.startsWith(today);
    }).length;
  } catch(e) {
    console.error('Auth list error:', e.message);
  }

  // ── 5. Construire le message ──
  const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

  let msg = `📊 <b>RÉCAP DU SOIR — ${dateStr.toUpperCase()}</b>\n`;
  msg += `🕐 Généré à ${heure}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `🔔 <b>ALERTES TELEGRAM</b>\n`;
  msg += `• Total envoyées : <b>${nbAlertes}</b>\n`;
  msg += `• Utilisateurs concernés : <b>${usersAlertes}</b>\n`;
  if (topEspeces.length > 0) {
    msg += `• Top espèces : ${topEspeces.join(', ')}\n`;
  }
  if (topZones.length > 0) {
    msg += `• Top zones : ${topZones.join(', ')}\n`;
  }
  msg += `\n`;

  msg += `👤 <b>COMPTES</b>\n`;
  msg += `• Nouveaux inscrits : <b>${nbNouveauxComptes}</b>\n`;
  msg += `\n`;

  msg += `📝 <b>RETOURS UTILISATEURS</b>\n`;
  if (nbRetours === 0) {
    msg += `• Aucun retour aujourd'hui\n`;
  } else {
    msg += `• Total : <b>${nbRetours}</b>\n`;
    if (typesRetours.espece)        msg += `  🐜 Espèces : ${typesRetours.espece}\n`;
    if (typesRetours.bug)           msg += `  🐛 Bugs : ${typesRetours.bug}\n`;
    if (typesRetours.fonctionnalite) msg += `  💡 Idées : ${typesRetours.fonctionnalite}\n`;
    if (typesRetours.autre)         msg += `  💬 Autres : ${typesRetours.autre}\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (nbAlertes === 0 && nbNouveauxComptes === 0 && nbRetours === 0) {
    msg += `😴 Journée calme — aucune activité aujourd'hui.`;
  } else {
    msg += `🐜 Bonne nuit !`;
  }

  console.log('Message:\n', msg);
  await sendTelegram(msg);
  process.exit(0);
}

main().catch(e => {
  console.error('Erreur:', e);
  process.exit(1);
});
