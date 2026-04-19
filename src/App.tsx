import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  BrainCircuit,
  Download,
  Zap,
  Key,
  Check,
  ShieldAlert,
  Clock3,
  Network,
  Gauge,
  GitCompareArrows,
  ArrowLeft,
  BarChart3,
  LineChart,
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

interface CryptoData {
  [key: string]: {
    usd: number;
    usd_24h_change: number;
  };
}

interface MarketSnapshot {
  timestamp: number;
  prices: Record<string, number>;
  change24h: Record<string, number>;
}

interface CoinRelation {
  id: string;
  name: string;
  symbol: string;
  price: number;
  change24h: number;
  momentum: number;
  sparklinePoints: string;
}

interface MarketIntelligence {
  coins: CoinRelation[];
  positiveCount: number;
  avgChange: number;
  volatility: number;
  regime: string;
  leaders: CoinRelation[];
  laggards: CoinRelation[];
  dominance: Array<{ symbol: string; share: number }>;
  divergencePairs: Array<{ pair: string; spread: number }>;
  correlations: Array<{ pair: string; value: number }>;
  aiContext: string;
}

interface HistoricalPoint {
  timestamp: number;
  price: number;
  marketCap: number;
  volume: number;
}

interface TradeSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reason: string;
  risk: string;
}

const COINS = [
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH' },
  { id: 'solana', name: 'Solana', symbol: 'SOL' },
  { id: 'ripple', name: 'XRP', symbol: 'XRP' },
  { id: 'cardano', name: 'Cardano', symbol: 'ADA' },
  { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE' },
  { id: 'chainlink', name: 'Chainlink', symbol: 'LINK' },
  { id: 'avalanche-2', name: 'Avalanche', symbol: 'AVAX' },
  { id: 'polkadot', name: 'Polkadot', symbol: 'DOT' },
  { id: 'litecoin', name: 'Litecoin', symbol: 'LTC' },
  { id: 'tron', name: 'TRON', symbol: 'TRX' },
  { id: 'toncoin', name: 'Toncoin', symbol: 'TON' },
  { id: 'bitcoin-cash', name: 'Bitcoin Cash', symbol: 'BCH' },
  { id: 'near', name: 'NEAR Protocol', symbol: 'NEAR' },
  { id: 'uniswap', name: 'Uniswap', symbol: 'UNI' },
];

const HISTORY_CAP = 140;
const SPARKLINE_SAMPLES = 24;
const CHART_DAYS = 14;

const formatMoney = (value: number) =>
  `$${value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 2 })}`;

const formatShort = (value: number) => {
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(2);
};

const formatTimestamp = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const toSnapshot = (input: CryptoData): MarketSnapshot => ({
  timestamp: Date.now(),
  prices: Object.fromEntries(COINS.map((coin) => [coin.id, input[coin.id]?.usd ?? 0])),
  change24h: Object.fromEntries(COINS.map((coin) => [coin.id, input[coin.id]?.usd_24h_change ?? 0])),
});

const stdDev = (values: number[]) => {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const pearsonCorrelation = (a: number[], b: number[]) => {
  if (a.length !== b.length || a.length < 3) return 0;

  const avgA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const avgB = b.reduce((sum, value) => sum + value, 0) / b.length;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const diffA = a[i] - avgA;
    const diffB = b[i] - avgB;
    numerator += diffA * diffB;
    denomA += diffA ** 2;
    denomB += diffB ** 2;
  }

  const denominator = Math.sqrt(denomA * denomB);
  if (!denominator) return 0;
  return numerator / denominator;
};

const sparklinePoints = (coinId: string, history: MarketSnapshot[]) => {
  const points = history
    .slice(-SPARKLINE_SAMPLES)
    .map((entry) => entry.prices[coinId])
    .filter((value) => value > 0);

  if (points.length < 2) return '';

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  return points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');
};

const seriesPoints = (values: number[]) => {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(' ');
};

const momentumFromHistory = (coinId: string, history: MarketSnapshot[], currentPrice: number) => {
  const baseline = history.at(-10)?.prices[coinId] ?? history.at(0)?.prices[coinId];
  if (!baseline) return 0;
  return ((currentPrice - baseline) / baseline) * 100;
};

const buildReturnSeries = (values: number[]) => {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    if (!values[i - 1]) continue;
    returns.push(((values[i] - values[i - 1]) / values[i - 1]) * 100);
  }
  return returns;
};

const maxDrawdownPct = (values: number[]) => {
  if (!values.length) return 0;
  let peak = values[0];
  let maxDrawdown = 0;

  for (const value of values) {
    if (value > peak) peak = value;
    const drawdown = ((peak - value) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
};

const extractJsonObject = (text: string) => {
  const direct = text.trim();
  if (direct.startsWith('{') && direct.endsWith('}')) return direct;

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return '';
};

const parseTradeSignal = (raw: string): TradeSignal => {
  try {
    const json = extractJsonObject(raw);
    if (!json) throw new Error('No JSON payload.');
    const parsed = JSON.parse(json) as Partial<TradeSignal>;

    const action = parsed.action === 'BUY' || parsed.action === 'SELL' || parsed.action === 'HOLD' ? parsed.action : 'HOLD';
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence ?? 50)));

    return {
      action,
      confidence,
      reason: String(parsed.reason ?? 'No reason returned by model.'),
      risk: String(parsed.risk ?? 'No risk note returned by model.'),
    };
  } catch {
    const upper = raw.toUpperCase();
    const action: TradeSignal['action'] = upper.includes('SELL') ? 'SELL' : upper.includes('BUY') ? 'BUY' : 'HOLD';
    return {
      action,
      confidence: 45,
      reason: raw.slice(0, 180) || 'Unable to parse model output.',
      risk: 'Model output did not return strict JSON.',
    };
  }
};

const buildIntelligence = (currentData: CryptoData, history: MarketSnapshot[]): MarketIntelligence => {
  const coins = COINS.map((coin) => {
    const price = currentData[coin.id]?.usd ?? 0;
    const change24h = currentData[coin.id]?.usd_24h_change ?? 0;

    return {
      ...coin,
      price,
      change24h,
      momentum: momentumFromHistory(coin.id, history, price),
      sparklinePoints: sparklinePoints(coin.id, history),
    };
  });

  const changes = coins.map((coin) => coin.change24h);
  const positiveCount = changes.filter((value) => value >= 0).length;
  const avgChange = changes.reduce((sum, value) => sum + value, 0) / (changes.length || 1);
  const volatility = stdDev(changes);

  const sortedByChange = [...coins].sort((a, b) => b.change24h - a.change24h);
  const leaders = sortedByChange.slice(0, 3);
  const laggards = [...sortedByChange].reverse().slice(0, 3);

  const totalPrice = coins.reduce((sum, coin) => sum + coin.price, 0) || 1;
  const dominance = [...coins]
    .map((coin) => ({ symbol: coin.symbol, share: (coin.price / totalPrice) * 100 }))
    .sort((a, b) => b.share - a.share);

  const divergencePairs: Array<{ pair: string; spread: number }> = [];
  for (let i = 0; i < coins.length; i += 1) {
    for (let j = i + 1; j < coins.length; j += 1) {
      divergencePairs.push({
        pair: `${coins[i].symbol}/${coins[j].symbol}`,
        spread: Math.abs(coins[i].change24h - coins[j].change24h),
      });
    }
  }

  const returnsByCoin = Object.fromEntries(COINS.map((coin) => [coin.id, [] as number[]]));

  for (let i = 1; i < history.length; i += 1) {
    const prev = history[i - 1];
    const next = history[i];

    COINS.forEach((coin) => {
      const prevPrice = prev.prices[coin.id];
      const nextPrice = next.prices[coin.id];
      if (!prevPrice || !nextPrice) return;
      const ret = ((nextPrice - prevPrice) / prevPrice) * 100;
      returnsByCoin[coin.id].push(ret);
    });
  }

  const correlations: Array<{ pair: string; value: number }> = [];

  for (let i = 0; i < COINS.length; i += 1) {
    for (let j = i + 1; j < COINS.length; j += 1) {
      const first = COINS[i];
      const second = COINS[j];
      const firstSeries = returnsByCoin[first.id];
      const secondSeries = returnsByCoin[second.id];
      const minLength = Math.min(firstSeries.length, secondSeries.length);
      if (minLength < 3) continue;

      const value = pearsonCorrelation(
        firstSeries.slice(-minLength),
        secondSeries.slice(-minLength),
      );

      correlations.push({ pair: `${first.symbol}/${second.symbol}`, value });
    }
  }

  const breadthRatio = positiveCount / COINS.length;
  const regime =
    breadthRatio >= 0.67 && avgChange > 0
      ? 'Risk-On Expansion'
      : breadthRatio <= 0.33 && avgChange < 0
        ? 'Risk-Off Compression'
        : 'Mixed Rotation';

  const aiContext = [
    `Regime: ${regime}`,
    `Breadth: ${positiveCount}/${COINS.length} positive`,
    `Average 24h Change: ${avgChange.toFixed(2)}%`,
    `Cross-Asset Volatility: ${volatility.toFixed(2)}%`,
    `Leaders: ${leaders.map((coin) => `${coin.symbol} ${coin.change24h.toFixed(2)}%`).join(', ')}`,
    `Laggards: ${laggards.map((coin) => `${coin.symbol} ${coin.change24h.toFixed(2)}%`).join(', ')}`,
    `Top Divergences: ${divergencePairs
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 4)
      .map((pair) => `${pair.pair} ${pair.spread.toFixed(2)}%`)
      .join(', ')}`,
    `Top Correlations: ${correlations
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 4)
      .map((pair) => `${pair.pair} ${pair.value.toFixed(2)}`)
      .join(', ') || 'insufficient history'}`,
  ].join('\n');

  return {
    coins,
    positiveCount,
    avgChange,
    volatility,
    regime,
    leaders,
    laggards,
    dominance,
    divergencePairs: divergencePairs.sort((a, b) => b.spread - a.spread).slice(0, 5),
    correlations: correlations.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 5),
    aiContext,
  };
};

function InteractiveLineChart({
  title,
  data,
  color,
  valueFormatter,
}: {
  title: string;
  data: Array<{ timestamp: number; value: number }>;
  color: string;
  valueFormatter: (value: number) => string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const values = data.map((point) => point.value);
  const points = seriesPoints(values);
  const activeIndex = hoverIndex ?? (data.length ? data.length - 1 : null);
  const activePoint = activeIndex !== null ? data[activeIndex] : null;

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
      <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-zinc-200">
        <LineChart className="h-4 w-4 text-cyan-300" />
        {title}
      </h3>
      <div className="relative h-48 rounded-md border border-zinc-800 bg-zinc-900/80 p-2">
        {points ? (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-full w-full"
            onMouseLeave={() => setHoverIndex(null)}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
              const idx = Math.round(ratio * (data.length - 1));
              setHoverIndex(idx);
            }}
          >
            <polyline fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" points={points} />
            {activeIndex !== null && data.length > 1 && (
              <>
                <line
                  x1={(activeIndex / (data.length - 1)) * 100}
                  x2={(activeIndex / (data.length - 1)) * 100}
                  y1="0"
                  y2="100"
                  stroke="rgba(148,163,184,0.45)"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={(activeIndex / (data.length - 1)) * 100}
                  cy={(() => {
                    const min = Math.min(...values);
                    const max = Math.max(...values);
                    const range = max - min || 1;
                    return 100 - ((values[activeIndex] - min) / range) * 100;
                  })()}
                  r="1.6"
                  fill={color}
                />
              </>
            )}
          </svg>
        ) : (
          <p className="pt-16 text-center text-xs text-zinc-500">Not enough chart points yet.</p>
        )}

        {activePoint && (
          <div className="absolute left-2 top-2 rounded-md border border-zinc-700 bg-zinc-950/95 px-2 py-1 text-[11px]">
            <p className="font-semibold text-zinc-100">{valueFormatter(activePoint.value)}</p>
            <p className="text-zinc-400">{formatTimestamp(activePoint.timestamp)}</p>
          </div>
        )}
      </div>
    </article>
  );
}

function InteractiveBarChart({
  title,
  data,
  valueFormatter,
  positiveColor,
  negativeColor,
}: {
  title: string;
  data: Array<{ timestamp: number; value: number }>;
  valueFormatter: (value: number) => string;
  positiveColor: string;
  negativeColor?: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const activeIndex = hoverIndex ?? (data.length ? data.length - 1 : null);
  const activePoint = activeIndex !== null ? data[activeIndex] : null;

  const maxAbs = data.reduce((acc, point) => Math.max(acc, Math.abs(point.value)), 0) || 1;

  return (
    <article className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
      <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-bold text-zinc-200">
        <BarChart3 className="h-4 w-4 text-emerald-300" />
        {title}
      </h3>
      <div className="relative h-48 rounded-md border border-zinc-800 bg-zinc-900/80 p-2">
        {data.length ? (
          <div className="flex h-full items-end gap-0.5">
            {data.map((point, idx) => {
              const positive = point.value >= 0;
              const color = positive ? positiveColor : negativeColor ?? positiveColor;
              return (
                <button
                  key={`${title}-${point.timestamp}`}
                  type="button"
                  onMouseEnter={() => setHoverIndex(idx)}
                  onFocus={() => setHoverIndex(idx)}
                  onMouseLeave={() => setHoverIndex(null)}
                  className="flex-1 rounded-t-sm"
                  style={{
                    height: `${Math.min(100, Math.max(8, (Math.abs(point.value) / maxAbs) * 100))}%`,
                    backgroundColor: color,
                    opacity: activeIndex === idx ? 1 : 0.72,
                  }}
                  aria-label={`${title} ${valueFormatter(point.value)}`}
                />
              );
            })}
          </div>
        ) : (
          <p className="pt-16 text-center text-xs text-zinc-500">Not enough bars yet.</p>
        )}

        {activePoint && (
          <div className="absolute left-2 top-2 rounded-md border border-zinc-700 bg-zinc-950/95 px-2 py-1 text-[11px]">
            <p className="font-semibold text-zinc-100">{valueFormatter(activePoint.value)}</p>
            <p className="text-zinc-400">{formatTimestamp(activePoint.timestamp)}</p>
          </div>
        )}
      </div>
    </article>
  );
}

export default function App() {
  const [data, setData] = useState<CryptoData | null>(null);
  const [marketHistory, setMarketHistory] = useState<MarketSnapshot[]>([]);
  const marketHistoryRef = useRef<MarketSnapshot[]>([]);

  const [historicalByCoin, setHistoricalByCoin] = useState<Record<string, HistoricalPoint[]>>({});
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [historicalError, setHistoricalError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('GEMINI_USER_KEY') || '');
  const [selectedCoinId, setSelectedCoinId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const ai = useMemo(() => {
    const key = userApiKey.trim();
    if (!key) return null;
    return new GoogleGenAI({ apiKey: key });
  }, [userApiKey]);

  const [aiSynthesis, setAiSynthesis] = useState<string | null>(null);
  const [tradeSignal, setTradeSignal] = useState<TradeSignal | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const lastSynthesisTime = useRef<number>(0);
  const hasApiKey = userApiKey.trim().length > 0;
  const cursorCoreRef = useRef<HTMLDivElement | null>(null);
  const cursorGlowRef = useRef<HTMLDivElement | null>(null);

  const intelligence = useMemo(() => {
    if (!data) return null;
    return buildIntelligence(data, marketHistory);
  }, [data, marketHistory]);

  const selectedCoin = useMemo(
    () => intelligence?.coins.find((coin) => coin.id === selectedCoinId) ?? null,
    [intelligence, selectedCoinId],
  );

  const selectedCoinHistory = useMemo(() => {
    if (!selectedCoin) return [] as HistoricalPoint[];
    return historicalByCoin[selectedCoin.id] ?? [];
  }, [selectedCoin, historicalByCoin]);

  const selectedCoinAnalytics = useMemo(() => {
    if (!selectedCoin || !selectedCoinHistory.length) return null;

    const priceSeries = selectedCoinHistory.map((point) => point.price);
    const returnSeries = buildReturnSeries(priceSeries);
    const volumeSeries = selectedCoinHistory.map((point) => point.volume);
    const marketCapSeries = selectedCoinHistory.map((point) => point.marketCap);

    const winRate = returnSeries.length
      ? (returnSeries.filter((value) => value >= 0).length / returnSeries.length) * 100
      : 0;

    return {
      returnSeries,
      realizedVol: stdDev(returnSeries),
      maxDrawdown: maxDrawdownPct(priceSeries),
      winRate,
      pricePoints: seriesPoints(priceSeries),
      marketCapPoints: seriesPoints(marketCapSeries),
      volumeBars: volumeSeries,
      correlationToMarket: intelligence
        ? pearsonCorrelation(
            returnSeries.slice(-Math.min(returnSeries.length, intelligence.coins.length * 6)),
            Array.from({ length: Math.min(returnSeries.length, intelligence.coins.length * 6) }, () =>
              intelligence.avgChange / 24,
            ),
          )
        : 0,
    };
  }, [selectedCoin, selectedCoinHistory, intelligence]);

  const fetchCoinHistory = async (coinId: string, force = false) => {
    if (!force && historicalByCoin[coinId]?.length) return;

    setHistoricalLoading(true);
    setHistoricalError(null);

    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${CHART_DAYS}&interval=hourly`,
      );
      if (!response.ok) throw new Error('Unable to fetch historical chart data.');

      const chart = await response.json();
      const prices: [number, number][] = chart.prices ?? [];
      const marketCaps: [number, number][] = chart.market_caps ?? [];
      const volumes: [number, number][] = chart.total_volumes ?? [];

      const mapped: HistoricalPoint[] = prices.map(([timestamp, price], index) => ({
        timestamp,
        price,
        marketCap: marketCaps[index]?.[1] ?? 0,
        volume: volumes[index]?.[1] ?? 0,
      }));

      setHistoricalByCoin((previous) => ({ ...previous, [coinId]: mapped }));
    } catch (err) {
      setHistoricalError(err instanceof Error ? err.message : 'Unknown historical-data error');
    } finally {
      setHistoricalLoading(false);
    }
  };

  const generateSynthesis = async (currentData: CryptoData, contextSummary: string, force = false) => {
    if (!ai) {
      setAiSynthesis('API Key required for synthesis.');
      return;
    }

    const now = Date.now();
    if (!force && now - lastSynthesisTime.current < 240000 && aiSynthesis) return;

    setSynthesizing(true);
    try {
      const prompt = `You are an elite crypto trading AI analyst.

Return ONLY a JSON object using this exact schema:
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": number, // 0-100
  "reason": string, // <= 140 chars
  "risk": string // <= 140 chars
}

Use this relational context and market data:
${contextSummary}

Raw data:
${JSON.stringify(currentData)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      const text = response.text || '';
      const signal = parseTradeSignal(text);
      setTradeSignal(signal);
      setAiSynthesis(`${signal.action} (${signal.confidence.toFixed(0)}%): ${signal.reason}`);
      lastSynthesisTime.current = now;
    } catch (err) {
      console.error('AI synthesis failed:', err);
      setAiSynthesis('AI analysis failed. Check your key and quota.');
      setTradeSignal(null);
    } finally {
      setSynthesizing(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = COINS.map((coin) => coin.id).join(',');
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      );
      if (!response.ok) throw new Error('Failed to fetch data from API');
      const json = await response.json();

      const snapshot = toSnapshot(json);
      const nextHistory = [...marketHistoryRef.current, snapshot].slice(-HISTORY_CAP);
      marketHistoryRef.current = nextHistory;

      setMarketHistory(nextHistory);
      setData(json);
      setLastUpdated(new Date());

      const latestIntelligence = buildIntelligence(json, nextHistory);
      if (hasApiKey) {
        generateSynthesis(json, latestIntelligence.aiContext);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedCoinId) return;
    fetchCoinHistory(selectedCoinId);
  }, [selectedCoinId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(hover: none), (pointer: coarse)').matches) return;

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const render = { x: target.x, y: target.y };
    let raf = 0;
    let active = false;

    const setVisible = (visible: boolean) => {
      const opacity = visible ? '1' : '0';
      if (cursorCoreRef.current) cursorCoreRef.current.style.opacity = opacity;
      if (cursorGlowRef.current) cursorGlowRef.current.style.opacity = visible ? '0.95' : '0';
    };

    const tick = () => {
      render.x += (target.x - render.x) * 0.18;
      render.y += (target.y - render.y) * 0.18;
      if (cursorCoreRef.current) {
        cursorCoreRef.current.style.transform = `translate3d(${render.x}px, ${render.y}px, 0)`;
      }
      if (cursorGlowRef.current) {
        cursorGlowRef.current.style.transform = `translate3d(${render.x}px, ${render.y}px, 0)`;
      }
      raf = window.requestAnimationFrame(tick);
    };

    const onMove = (event: MouseEvent) => {
      target.x = event.clientX;
      target.y = event.clientY;
      if (!active) {
        active = true;
        setVisible(true);
      }
    };

    const onLeave = () => {
      active = false;
      setVisible(false);
    };

    raf = window.requestAnimationFrame(tick);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseleave', onLeave);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const downloadTaxSnapshot = () => {
    if (!data) return;
    const snapshot = {
      timestamp: new Date().toISOString(),
      prices: data,
      relations: intelligence
        ? {
            regime: intelligence.regime,
            breadth: `${intelligence.positiveCount}/${COINS.length}`,
            average_change: intelligence.avgChange,
            volatility: intelligence.volatility,
            leaders: intelligence.leaders.map((coin) => coin.symbol),
            laggards: intelligence.laggards.map((coin) => coin.symbol),
          }
        : null,
      ai_signal: tradeSignal,
      compliance_hash: `simulated_sha256_${Date.now().toString(16)}`,
      agent_signature: 'SYS.AGENT_VERIFIED',
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crypto_tax_snapshot_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveKey = () => {
    const key = userApiKey.trim();
    if (!key) {
      localStorage.removeItem('GEMINI_USER_KEY');
      return;
    }

    localStorage.setItem('GEMINI_USER_KEY', key);
    setShowKeyInput(false);

    if (data && intelligence) {
      generateSynthesis(data, intelligence.aiContext, true);
    }
  };

  const handleClearKey = () => {
    setUserApiKey('');
    localStorage.removeItem('GEMINI_USER_KEY');
    setAiSynthesis('API Key required for synthesis.');
    setTradeSignal(null);
  };

  return (
    <div className="app-shell min-h-screen text-zinc-100 selection:bg-cyan-400/25">
      <div className="app-texture-layer" aria-hidden="true" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10">
        <header className="panel-glass relative overflow-hidden rounded-2xl border border-zinc-800/80 p-5 sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-cyan-400/15 blur-2xl" />
          <div className="pointer-events-none absolute -left-12 bottom-0 h-28 w-28 rounded-full bg-emerald-400/10 blur-2xl" />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1 text-[11px] tracking-[0.22em] text-cyan-300 uppercase">
                <Activity className="h-3.5 w-3.5" />
                Crypto Intelligence Deck
              </div>
              <h1 className="text-balance text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
                Real-time market structure with actionable AI trade signals
              </h1>
              <p className="max-w-2xl text-sm text-zinc-300/80 sm:text-base">
                Click any asset for real historical charts (price, volume, market cap) and interactive exploration.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button
                onClick={() => setShowKeyInput(!showKeyInput)}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold tracking-wide transition-colors ${
                  hasApiKey
                    ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/18'
                    : 'border-amber-500/40 bg-amber-500/12 text-amber-300 hover:bg-amber-500/20'
                }`}
                title={hasApiKey ? 'API Key Active' : 'API Key Required'}
                aria-label={hasApiKey ? 'API key active' : 'API key required'}
              >
                {hasApiKey ? <Key className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                {hasApiKey ? 'AI Key Active' : 'BYOK Required'}
              </button>

              <button
                onClick={fetchData}
                disabled={loading}
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-xs font-semibold tracking-wide text-zinc-200 transition-colors hover:bg-zinc-800/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh Feed
              </button>
            </div>
          </div>

          <div className="relative mt-5 grid grid-cols-1 gap-3 text-xs text-zinc-300 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
              <span className="text-zinc-500">Data source</span>
              <p className="mt-1 font-semibold text-zinc-100">CoinGecko Live + Historical APIs</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
              <span className="text-zinc-500">Regime</span>
              <p className="mt-1 font-semibold text-cyan-300">{intelligence?.regime ?? '--'}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
              <span className="text-zinc-500">Volatility</span>
              <p className="mt-1 font-semibold text-zinc-100">{intelligence ? `${intelligence.volatility.toFixed(2)}%` : '--'}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
              <span className="text-zinc-500">Last sync</span>
              <p className="mt-1 inline-flex items-center gap-1.5 font-semibold text-zinc-100">
                <Clock3 className="h-3.5 w-3.5 text-cyan-300" />
                {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Waiting...'}
              </p>
            </div>
          </div>
        </header>

        {showKeyInput && (
          <section className="panel-glass rounded-2xl border border-zinc-800/85 p-5 sm:p-6" aria-label="Gemini API key setup">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-cyan-300 uppercase">
                <Key className="h-4 w-4" />
                Gemini API Key Configuration
              </h2>
              {hasApiKey && (
                <button
                  onClick={handleClearKey}
                  className="cursor-pointer text-[11px] text-zinc-500 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-rose-300"
                >
                  Clear Stored Key
                </button>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <label htmlFor="gemini-key" className="sr-only">
                Gemini API key
              </label>
              <input
                id="gemini-key"
                type="password"
                value={userApiKey}
                onChange={(event) => setUserApiKey(event.target.value)}
                placeholder="Enter Gemini API key"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950/95 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-cyan-400"
              />
              <button
                onClick={handleSaveKey}
                className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-cyan-400/40 bg-cyan-400/15 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/25"
              >
                <Check className="h-4 w-4" />
                Save Key
              </button>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              BYOK only. Once saved, AI instantly analyzes market structure and returns a BUY / SELL / HOLD signal.
            </p>
          </section>
        )}

        {error && (
          <section className="rounded-xl border border-rose-500/35 bg-rose-500/10 p-4 text-rose-200" aria-live="polite">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="font-semibold">Connection Error</h2>
                <p className="mt-1 text-sm text-rose-100/80">{error}</p>
              </div>
            </div>
          </section>
        )}

        {selectedCoin ? (
          <main className="grid grid-cols-1 gap-5">
            <section className="panel-glass rounded-2xl border border-zinc-800/85 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <button
                    type="button"
                    onClick={() => setSelectedCoinId(null)}
                    className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to all assets
                  </button>
                  <h2 className="text-2xl font-bold text-zinc-50">{selectedCoin.name} Real Data View</h2>
                  <p className="mt-1 text-sm text-zinc-400">Interactive 14-day hourly chart stack from CoinGecko historical feed.</p>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-4 py-3">
                  <p className="text-xs text-zinc-500">Current spot price</p>
                  <p className="text-xl font-bold text-zinc-100">{formatMoney(selectedCoin.price)}</p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                <article className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">24h Change</p>
                  <p className={`mt-1 text-lg font-bold ${selectedCoin.change24h >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {selectedCoin.change24h.toFixed(2)}%
                  </p>
                </article>
                <article className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">Momentum</p>
                  <p className={`mt-1 text-lg font-bold ${selectedCoin.momentum >= 0 ? 'text-cyan-300' : 'text-amber-300'}`}>
                    {selectedCoin.momentum.toFixed(2)}%
                  </p>
                </article>
                <article className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">Realized Volatility</p>
                  <p className="mt-1 text-lg font-bold text-zinc-100">{selectedCoinAnalytics ? `${selectedCoinAnalytics.realizedVol.toFixed(2)}%` : '--'}</p>
                </article>
                <article className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">Max Drawdown</p>
                  <p className="mt-1 text-lg font-bold text-amber-300">{selectedCoinAnalytics ? `${selectedCoinAnalytics.maxDrawdown.toFixed(2)}%` : '--'}</p>
                </article>
              </div>

              {historicalLoading ? (
                <p className="mt-4 text-sm text-zinc-400">Loading real historical chart data...</p>
              ) : historicalError ? (
                <p className="mt-4 text-sm text-rose-300">{historicalError}</p>
              ) : selectedCoinHistory.length ? (
                <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <InteractiveLineChart
                    title="Price (real hourly history)"
                    data={selectedCoinHistory.map((point) => ({ timestamp: point.timestamp, value: point.price }))}
                    color={selectedCoin.change24h >= 0 ? '#34d399' : '#f43f5e'}
                    valueFormatter={(value) => formatMoney(value)}
                  />

                  <InteractiveLineChart
                    title="Market Cap"
                    data={selectedCoinHistory.map((point) => ({ timestamp: point.timestamp, value: point.marketCap }))}
                    color="#22d3ee"
                    valueFormatter={(value) => `$${formatShort(value)}`}
                  />

                  <InteractiveBarChart
                    title="Volume"
                    data={selectedCoinHistory.slice(-72).map((point) => ({ timestamp: point.timestamp, value: point.volume }))}
                    valueFormatter={(value) => `$${formatShort(value)}`}
                    positiveColor="rgba(56, 189, 248, 0.72)"
                  />

                  <InteractiveBarChart
                    title="Return Pulse"
                    data={buildReturnSeries(selectedCoinHistory.map((point) => point.price))
                      .slice(-72)
                      .map((value, index) => ({
                        value,
                        timestamp: selectedCoinHistory[Math.min(index + 1, selectedCoinHistory.length - 1)].timestamp,
                      }))}
                    valueFormatter={(value) => `${value.toFixed(3)}%`}
                    positiveColor="rgba(52, 211, 153, 0.78)"
                    negativeColor="rgba(244, 63, 94, 0.78)"
                  />
                </div>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">Waiting for historical feed...</p>
              )}
            </section>
          </main>
        ) : (
          <main className="grid grid-cols-1 gap-5 xl:grid-cols-[2.25fr_1fr]">
            <section aria-label="Coin prices and relations" className="panel-glass rounded-2xl border border-zinc-800/85 p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-bold tracking-wide text-zinc-200 uppercase">Tracked Assets</h2>
                <span className="text-xs text-zinc-500">Click any card for real deep-dive charts</span>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {loading && !data
                  ? Array.from({ length: 12 }).map((_, i) => (
                      <article key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 animate-pulse">
                        <div className="mb-3 h-4 w-1/3 rounded bg-zinc-800" />
                        <div className="mb-2 h-7 w-1/2 rounded bg-zinc-800" />
                        <div className="h-4 w-1/4 rounded bg-zinc-800" />
                      </article>
                    ))
                  : intelligence?.coins.map((coin) => {
                      const isPositive = coin.change24h >= 0;
                      const momentumPositive = coin.momentum >= 0;

                      return (
                        <button
                          key={coin.id}
                          type="button"
                          onClick={() => {
                            setSelectedCoinId(coin.id);
                            fetchCoinHistory(coin.id);
                          }}
                          className="coin-card relative cursor-pointer overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-900/65 p-4 text-left transition-transform hover:-translate-y-0.5"
                        >
                          <div className="pointer-events-none absolute right-0 top-0 h-16 w-16 rounded-full bg-cyan-400/10 blur-xl" />

                          <div className="relative mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold text-zinc-200">
                              {coin.name}
                              <span className="ml-1.5 text-xs font-medium text-zinc-500">{coin.symbol}</span>
                            </h3>
                            <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-zinc-400 uppercase">
                              Deep Dive
                            </span>
                          </div>

                          <p className="relative text-xl font-bold tracking-tight text-zinc-50 sm:text-2xl">{formatMoney(coin.price)}</p>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <p
                              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold ${
                                isPositive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                              }`}
                            >
                              {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                              24h {Math.abs(coin.change24h).toFixed(2)}%
                            </p>

                            <p
                              className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ${
                                momentumPositive ? 'bg-cyan-500/15 text-cyan-300' : 'bg-amber-500/15 text-amber-300'
                              }`}
                            >
                              momentum {coin.momentum.toFixed(2)}%
                            </p>
                          </div>

                          <div className="mt-3 h-9 rounded-md border border-zinc-800 bg-zinc-950/80 px-1.5 py-1">
                            {coin.sparklinePoints ? (
                              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                                <polyline
                                  fill="none"
                                  stroke={isPositive ? '#34d399' : '#f43f5e'}
                                  strokeWidth="4"
                                  strokeLinecap="round"
                                  points={coin.sparklinePoints}
                                />
                              </svg>
                            ) : (
                              <p className="text-center text-[10px] text-zinc-500">collecting stream...</p>
                            )}
                          </div>
                        </button>
                      );
                    })}
              </div>

              <section className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <article className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <h3 className="mb-3 inline-flex items-center gap-2 text-xs font-bold tracking-wide text-zinc-300 uppercase">
                    <Gauge className="h-4 w-4 text-cyan-300" />
                    Market Breadth
                  </h3>
                  <p className="text-xl font-bold text-zinc-100">{intelligence ? `${intelligence.positiveCount}/${COINS.length}` : '--'}</p>
                  <p className="mt-1 text-xs text-zinc-500">Avg move: {intelligence ? `${intelligence.avgChange.toFixed(2)}%` : '--'}</p>
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                      style={{ width: intelligence ? `${(intelligence.positiveCount / COINS.length) * 100}%` : '0%' }}
                    />
                  </div>
                </article>

                <article className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <h3 className="mb-3 inline-flex items-center gap-2 text-xs font-bold tracking-wide text-zinc-300 uppercase">
                    <GitCompareArrows className="h-4 w-4 text-emerald-300" />
                    Divergence Pairs
                  </h3>
                  <div className="space-y-2">
                    {intelligence?.divergencePairs.map((pair) => (
                      <div key={pair.pair} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5">
                        <span className="text-xs text-zinc-300">{pair.pair}</span>
                        <span className="text-xs font-semibold text-amber-300">{pair.spread.toFixed(2)}%</span>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <h3 className="mb-3 inline-flex items-center gap-2 text-xs font-bold tracking-wide text-zinc-300 uppercase">
                    <Network className="h-4 w-4 text-cyan-300" />
                    Rolling Correlations
                  </h3>
                  <div className="space-y-2">
                    {intelligence?.correlations.length ? (
                      intelligence.correlations.map((pair) => (
                        <div key={pair.pair} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5">
                          <span className="text-xs text-zinc-300">{pair.pair}</span>
                          <span className={`text-xs font-semibold ${pair.value >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>
                            {pair.value.toFixed(2)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-500">Need at least 3 return intervals to compute correlations.</p>
                    )}
                  </div>
                </article>
              </section>
            </section>

            <aside className="grid grid-cols-1 gap-5">
              <section className="panel-glass rounded-2xl border border-zinc-800/85 p-5">
                <div className="mb-3 flex items-center gap-2 text-cyan-300">
                  <BrainCircuit className="h-4 w-4" />
                  <h2 className="text-sm font-bold tracking-wide uppercase">AI Trade Signal</h2>
                </div>

                {hasApiKey ? (
                  <div className="space-y-3">
                    {tradeSignal && (
                      <div className="rounded-lg border border-zinc-700 bg-zinc-950/85 p-3">
                        <div className="flex items-center justify-between">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold tracking-wide ${
                              tradeSignal.action === 'BUY'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : tradeSignal.action === 'SELL'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {tradeSignal.action}
                          </span>
                          <span className="text-xs text-zinc-400">Confidence {tradeSignal.confidence.toFixed(0)}%</span>
                        </div>
                        <p className="mt-2 text-sm text-zinc-200">{tradeSignal.reason}</p>
                        <p className="mt-1 text-xs text-zinc-500">Risk: {tradeSignal.risk}</p>
                      </div>
                    )}

                    <p className="min-h-[48px] text-sm leading-relaxed text-zinc-200/90">
                      {synthesizing ? (
                        <span className="inline-flex items-center gap-2 text-zinc-300">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
                          Analyzing and generating BUY/SELL/HOLD...
                        </span>
                      ) : (
                        aiSynthesis || 'Awaiting first analysis run...'
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
                    <p className="text-sm font-semibold text-amber-300">AI analysis is locked in BYOK mode.</p>
                    <p className="mt-1 text-xs text-amber-100/75">Save your Gemini key to start BUY/SELL/HOLD analysis immediately.</p>
                  </div>
                )}
              </section>

              <section className="panel-glass rounded-2xl border border-zinc-800/85 p-5">
                <div className="mb-4 flex items-center gap-2 text-emerald-300">
                  <Zap className="h-4 w-4" />
                  <h2 className="text-sm font-bold tracking-wide uppercase">Agentic Tools</h2>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={downloadTaxSnapshot}
                    disabled={!data}
                    className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    Export Tax Snapshot
                  </button>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2.5">
                    <p className="text-xs text-zinc-500">Dominance by tracked price base</p>
                    <div className="mt-2 space-y-1.5">
                      {intelligence?.dominance.slice(0, 4).map((item) => (
                        <div key={item.symbol} className="flex items-center justify-between text-xs">
                          <span className="text-zinc-300">{item.symbol}</span>
                          <span className="font-semibold text-cyan-300">{item.share.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </aside>
          </main>
        )}

        <footer className="pb-4 text-center text-xs tracking-wide text-zinc-500">
          LIVE DATA STREAM • REAL HISTORICAL CHARTS • BYOK MODE • COINGECKO API
        </footer>
      </div>
      <div ref={cursorGlowRef} className="liquid-cursor liquid-cursor-glow" aria-hidden="true" />
      <div ref={cursorCoreRef} className="liquid-cursor liquid-cursor-core" aria-hidden="true" />
    </div>
  );
}
