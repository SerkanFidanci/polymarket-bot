import { useState, useEffect } from 'react';

interface DetailedTrade {
  id: number;
  time: string;
  strategy: string;
  decision: string;
  actual_result: string;
  pnl: number;
  bet_size: number;
  ev: number;
  pm_up: number;
  pm_down: number;
  score: number;
  conf: number;
  signal_orderbook: number;
  signal_ema_macd: number;
  signal_rsi_stoch: number;
  signal_vwap_bb: number;
  signal_cvd: number;
  signal_whale: number;
  signal_funding: number;
  signal_open_interest: number;
  signal_ls_ratio: number;
  btc_price_start: number;
  btc_price_end: number;
  exit_reason: string | null;
  exit_price: number | null;
  entry_price: number | null;
  fee_rate: number | null;
}

const SIG_NAMES = ['orderbook', 'ema_macd', 'rsi_stoch', 'vwap_bb', 'cvd', 'whale', 'funding', 'open_interest', 'ls_ratio'];
const SHORT_SIG: Record<string, string> = {
  orderbook: 'OB', ema_macd: 'EMA', rsi_stoch: 'RSI', vwap_bb: 'BB',
  cvd: 'CVD', whale: 'WHL', funding: 'FND', open_interest: 'OI', ls_ratio: 'LS'
};

export function TradeLog() {
  const [trades, setTrades] = useState<DetailedTrade[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/trades/detailed');
        if (res.ok) setTrades(await res.json());
      } catch {}
    };
    fetch_();
    const id = setInterval(fetch_, 15000);
    return () => clearInterval(id);
  }, []);

  const filtered = filter === 'ALL' ? trades : trades.filter(t => t.strategy === filter);
  const strats = ['ALL', ...Array.from(new Set(trades.map(t => t.strategy)))];

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-xs font-semibold">Trade Log (Detaylı)</div>
        <div className="flex gap-0.5 flex-wrap">
          {strats.map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-1.5 py-0.5 rounded text-[8px] mono ${filter === s ? 'bg-[var(--color-accent)] text-white' : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] hover:text-white'}`}
            >{s}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-[10px] text-[var(--color-text-dim)] text-center py-4">Henüz trade yok</div>
      ) : (
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {filtered.map(t => (
            <TradeCard key={`${t.strategy}-${t.id}`} trade={t} expanded={expanded === t.id} onToggle={() => setExpanded(expanded === t.id ? null : t.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TradeCard({ trade: t, expanded, onToggle }: { trade: DetailedTrade; expanded: boolean; onToggle: () => void }) {
  const dir = t.decision === 'BUY_UP' ? 'UP' : 'DOWN';
  const won = dir === t.actual_result;
  const pnl = t.pnl || 0;
  const entryP = t.entry_price || (dir === 'UP' ? t.pm_up : t.pm_down);
  const time = (t.time || '').replace('T', ' ').slice(5, 16);
  const btcMove = t.btc_price_end - t.btc_price_start;
  const btcMovePct = t.btc_price_start > 0 ? (btcMove / t.btc_price_start * 100) : 0;

  return (
    <div className="border border-[var(--color-border)]/50 rounded-lg overflow-hidden">
      {/* Summary row */}
      <div
        className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors text-[10px] mono ${won ? 'border-l-2 border-[var(--color-up)]' : pnl === 0 ? '' : 'border-l-2 border-[var(--color-down)]'}`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          <span className={`font-bold text-xs ${won ? 'text-[var(--color-up)]' : pnl === 0 ? 'text-[var(--color-text-dim)]' : 'text-[var(--color-down)]'}`}>
            {won ? 'WIN' : pnl === 0 ? 'FLAT' : 'LOSS'}
          </span>
          <span className="text-[var(--color-accent)] text-[9px]">{t.strategy}</span>
          <span className={dir === 'UP' ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>{dir}</span>
          <span className="text-[var(--color-text-dim)]">{time}</span>
          <span className="text-white">${(t.bet_size || 0).toFixed(2)}</span>
          {entryP > 0.01 && <span className="text-[var(--color-text-dim)]">@{(entryP * 100).toFixed(0)}c</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[var(--color-text-dim)]">Sc:{t.score?.toFixed(0)} Cf:{t.conf?.toFixed(0)}</span>
          <span className={`font-bold ${pnl > 0 ? 'text-[var(--color-up)]' : pnl < 0 ? 'text-[var(--color-down)]' : 'text-[var(--color-text-dim)]'}`}>
            {pnl > 0 ? '+' : ''}{pnl !== 0 ? '$' + pnl.toFixed(2) : '-'}
          </span>
          <span className="text-[var(--color-text-dim)] text-[9px]">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 py-2 bg-[var(--color-bg)] border-t border-[var(--color-border)]/30 text-[9px] mono space-y-2">
          {/* Round info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Info label="BTC Başlangıç" value={'$' + t.btc_price_start?.toFixed(2)} />
            <Info label="BTC Bitiş" value={'$' + t.btc_price_end?.toFixed(2)} color={btcMove >= 0 ? 'var(--color-up)' : 'var(--color-down)'} />
            <Info label="BTC Değişim" value={(btcMove >= 0 ? '+' : '') + '$' + btcMove.toFixed(0) + ' (' + btcMovePct.toFixed(2) + '%)' } color={btcMove >= 0 ? 'var(--color-up)' : 'var(--color-down)'} />
            <Info label="Gerçek Sonuç" value={t.actual_result} color={t.actual_result === 'UP' ? 'var(--color-up)' : 'var(--color-down)'} />
          </div>

          {/* Trade info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Info label="Giriş Fiyatı" value={entryP > 0.01 ? (entryP * 100).toFixed(1) + 'c' : '-'} />
            <Info label="Çıkış" value={t.exit_reason || 'held_to_expiry'} />
            <Info label="EV" value={t.ev ? t.ev.toFixed(4) : '-'} color={t.ev > 0 ? 'var(--color-up)' : 'var(--color-down)'} />
            <Info label="Fee" value={t.fee_rate ? (t.fee_rate * 100).toFixed(2) + '%' : '-'} />
          </div>

          {/* PM prices */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Info label="PM Up" value={t.pm_up ? (t.pm_up * 100).toFixed(1) + 'c' : '-'} color="var(--color-up)" />
            <Info label="PM Down" value={t.pm_down ? (t.pm_down * 100).toFixed(1) + 'c' : '-'} color="var(--color-down)" />
            <Info label="Combined Score" value={t.score?.toFixed(1)} color={t.score > 0 ? 'var(--color-up)' : 'var(--color-down)'} />
            <Info label="Confidence" value={t.conf?.toFixed(1)} />
          </div>

          {/* Signals */}
          <div>
            <div className="text-[var(--color-text-dim)] mb-1">Sinyaller (giriş anı):</div>
            <div className="flex flex-wrap gap-1">
              {SIG_NAMES.map(sig => {
                const val = (t as any)['signal_' + sig] as number;
                if (val === undefined || val === null) return null;
                const color = val > 5 ? 'var(--color-up)' : val < -5 ? 'var(--color-down)' : 'var(--color-text-dim)';
                return (
                  <span key={sig} className="px-1.5 py-0.5 rounded text-[8px] bg-[var(--color-surface-2)]">
                    <span className="text-[var(--color-text-dim)]">{SHORT_SIG[sig]}</span>
                    {' '}
                    <span style={{ color }}>{val.toFixed(0)}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Why this trade? */}
          <div className="text-[var(--color-text-dim)] border-t border-[var(--color-border)]/20 pt-1">
            <span className="text-[var(--color-text)]">Neden {dir}? </span>
            {generateReason(t, dir)}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[var(--color-text-dim)] text-[8px]">{label}</div>
      <div className="text-[10px]" style={{ color: color || 'var(--color-text)' }}>{value}</div>
    </div>
  );
}

function generateReason(t: DetailedTrade, dir: string): string {
  const parts: string[] = [];

  const ema = t.signal_ema_macd;
  if (Math.abs(ema) > 10) parts.push(ema > 0 ? 'EMA trend yukarı' : 'EMA trend aşağı');

  const rsi = t.signal_rsi_stoch;
  if (rsi < -30) parts.push('RSI aşırı satım (bounce)');
  else if (rsi > 30) parts.push('RSI aşırı alım (düşüş)');

  const cvd = t.signal_cvd;
  if (Math.abs(cvd) > 20) parts.push(cvd > 0 ? 'Alıcı baskısı güçlü' : 'Satıcı baskısı güçlü');

  const whale = t.signal_whale;
  if (Math.abs(whale) > 30) parts.push(whale > 0 ? 'Balinalar alıyor' : 'Balinalar satıyor');

  const ob = t.signal_orderbook;
  if (Math.abs(ob) > 30) parts.push(ob > 0 ? 'Orderbook alıcı ağırlıklı' : 'Orderbook satıcı ağırlıklı');

  if (t.pm_up > 0.55) parts.push('PM market UP\'a eğilimli');
  else if (t.pm_down > 0.55) parts.push('PM market DOWN\'a eğilimli');

  return parts.length > 0 ? parts.join(' • ') : 'Kombine sinyal skoru ' + dir + ' yönünde';
}
