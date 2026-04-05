import type { Router } from 'express';
import express from 'express';
import { polymarketClient } from './client.js';
import { isConfigured } from './auth.js';

const router: Router = express.Router();

// Status
router.get('/status', (_req, res) => {
  res.json({
    configured: isConfigured(),
    walletAddress: process.env.POLYMARKET_WALLET_ADDRESS ?? null,
  });
});

// Find current BTC 5-minute round
router.get('/current-round', async (_req, res) => {
  try {
    const round = await polymarketClient.findCurrentBtcRound();
    if (round) {
      res.json(round);
    } else {
      res.json({ found: false, message: 'No active BTC 5-min market' });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Refresh prices via CLOB order book (real-time)
router.get('/prices', async (req, res) => {
  try {
    const tokenIdUp = req.query.up as string;
    const tokenIdDown = req.query.down as string;
    const slug = req.query.slug as string | undefined;
    if (!tokenIdUp || !tokenIdDown) {
      res.status(400).json({ error: 'Missing up/down token IDs' });
      return;
    }
    const prices = await polymarketClient.refreshPrices(tokenIdUp, tokenIdDown, slug);
    if (prices) {
      res.json(prices);
    } else {
      res.status(404).json({ error: 'Could not fetch prices' });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Place order
router.post('/order', async (req, res) => {
  try {
    if (!isConfigured()) {
      res.status(400).json({ error: 'Polymarket API not configured' });
      return;
    }
    const { tokenId, price, size, side } = req.body as { tokenId: string; price: number; size: number; side?: 'BUY' | 'SELL' };
    const result = await polymarketClient.placeOrder(tokenId, price, size, side ?? 'BUY');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get positions
router.get('/positions', async (_req, res) => {
  try {
    const data = await polymarketClient.getPositions();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get balance
router.get('/balance', async (_req, res) => {
  try {
    const data = await polymarketClient.getBalance();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
