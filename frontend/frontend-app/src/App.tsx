import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';
import { PhaserGame } from './game/PhaserGame';

interface CellPosition {
  x: number;
  y: number;
}

interface PlayerState {
  id: string;
  name: string;
  position: CellPosition;
  unlockedColors: string[];
  inventory: Record<string, number>;
  totalCollected: number;
  colorLevels: Record<string, number>;
  satiety: number;
  weight: number;
  stamina: number;
  collectionPower: number;
  experience: number;
  power: number;
  level: number;
  availableUpgrades: number;
  health?: number;
  maxHealth?: number;
  defense?: number;
  luck?: number;
  regeneration?: number;
}

interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  createdAt: number;
}

interface LocalChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  createdAt: number;
  cellPosition: CellPosition;
}

interface LocalChatParticipant {
  id: string;
  name: string;
}

interface LocalChatData {
  cellPosition: CellPosition;
  participants: LocalChatParticipant[];
  messages: LocalChatMessage[];
}

interface LeaderboardEntry {
  playerId: string;
  name: string;
  totalCollected: number;
  level: number;
  playTime: number; // Время игры в секундах
  isOnline: boolean;
}

// Функция для извлечения RGB компонентов из HEX цвета
function getRGBComponents(hexColor: string): { r: number; g: number; b: number } {
  const hex = hexColor.replace('#', '');
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return { r, g, b };
  } else if (hex.length === 3) {
    const r = parseInt(hex.substring(0, 1) + hex.substring(0, 1), 16);
    const g = parseInt(hex.substring(1, 2) + hex.substring(1, 2), 16);
    const b = parseInt(hex.substring(2, 3) + hex.substring(2, 3), 16);
    return { r, g, b };
  }
  return { r: 0, g: 0, b: 0 };
}

// Функция для извлечения зеленого компонента из HEX цвета
function getGreenComponent(hexColor: string): number {
  return getRGBComponents(hexColor).g;
}

// Вычисление силы клетки: значение красного цвета (от 1 до 256)
// Это минимальная сила сбора, необходимая для тапа
function getCellPower(hexColor: string): number {
  const { r } = getRGBComponents(hexColor);
  return Math.max(1, r + 1); // От 1 до 256 (0-255 + 1)
}

// Вычисление веса одного элемента инвентаря
// Вес = (количество * зеленый компонент / 16) + (количество * синий компонент / 32)
function getItemWeight(color: string, count: number): number {
  const { g, b } = getRGBComponents(color);
  return (count * g / 16) + (count * b / 32);
}

// Вычисление общего веса инвентаря
function getInventoryWeight(inventory: Record<string, number>): number {
  let totalWeight = 0;
  for (const [color, count] of Object.entries(inventory)) {
    if (count > 0) {
      totalWeight += getItemWeight(color, count);
    }
  }
  return Math.round(totalWeight); // Округляем до целого
}

// Вычисление максимального веса инвентаря
// Максимальный вес = (вес игрока / 2) + (вес игрока / 2 * выносливость / 10)
function getMaxInventoryWeight(playerWeight: number, playerStamina: number): number {
  return Math.round((playerWeight / 2) + (playerWeight / 2 * playerStamina / 10));
}

// Генерация цветов для миникарты (та же логика, что и на сервере)
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = c;
    g = 0;
    b = x;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  const toHex = (v: number) => {
    const hv = Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
    return hv;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function generateColorPalette(count: number): string[] {
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const hue = (i * 137.508) % 360; // золотой угол
    const saturation = 60 + ((i * 7) % 40); // 60-100%
    const lightness = 40 + ((i * 11) % 30); // 40-70%
    colors.push(
      hslToHex(Math.floor(hue), Math.floor(saturation), Math.floor(lightness)),
    );
  }
  return colors;
}

const BASE_COLORS: string[] = generateColorPalette(256);

// Источники случайных цветов на карте (те же, что и на сервере)
const COLOR_SOURCES = [
  { position: { x: -10, y: 0 }, color: BASE_COLORS[5] },
  { position: { x: 10, y: 0 }, color: BASE_COLORS[25] },
  { position: { x: 0, y: -10 }, color: BASE_COLORS[55] },
  { position: { x: 0, y: 10 }, color: BASE_COLORS[105] },
];

// Вычисление силы клетки по красному компоненту
function getCellPowerFromColor(color: string): number {
  const hex = color.replace('#', '');
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    return Math.max(1, r + 1); // Сила от 1 до 256
  }
  return 1;
}

// Вычисление весов для цветов (обратно пропорционально силе)
function calculateColorWeights(): number[] {
  const weights: number[] = [];
  for (const color of BASE_COLORS) {
    const power = getCellPowerFromColor(color);
    // Вес обратно пропорционален силе в степени 1.5
    // Это означает, что сильные клетки появляются реже
    const weight = 1 / Math.pow(power, 1.5);
    weights.push(weight);
  }
  return weights;
}

// Предвычисленные веса для всех цветов
const COLOR_WEIGHTS_CLIENT = calculateColorWeights();
const TOTAL_WEIGHT_CLIENT = COLOR_WEIGHTS_CLIENT.reduce((sum, w) => sum + w, 0);

// Взвешенная выборка цвета на основе весов
function weightedRandomColor(seed: number): string {
  // Используем seed для генерации псевдослучайного числа в диапазоне [0, TOTAL_WEIGHT)
  const hash = Math.abs(seed);
  const normalized = (hash % 1000000) / 1000000;
  const randomValue = normalized * TOTAL_WEIGHT_CLIENT;
  
  let cumulativeWeight = 0;
  for (let i = 0; i < BASE_COLORS.length; i++) {
    cumulativeWeight += COLOR_WEIGHTS_CLIENT[i];
    if (randomValue <= cumulativeWeight) {
      return BASE_COLORS[i];
    }
  }
  // Fallback на последний цвет (на случай ошибок округления)
  return BASE_COLORS[BASE_COLORS.length - 1];
}

// Генератор диагональных линий с ограничением длины и случайной шириной
// Теперь учитывает силу клетки - чем сильнее клетка, тем реже она появляется
function pseudoRandomColor(x: number, y: number): string {
  // Диагональ вида x + y = const (идет сверху-слева вниз-вправо)
  const diagonalSum = x + y;
  
  // Разбиваем диагональ на сегменты длиной максимум 10 клеток
  const segmentIndex = Math.floor(diagonalSum / 10);
  
  // Генерируем ширину линии для этого сегмента (от 3)
  const widthSeed = (segmentIndex * 73856093) ^ (segmentIndex * 19349663);
  const lineWidth = 3 + (Math.abs(widthSeed) % 4); // 3-6 клеток шириной
  
  // Определяем перпендикулярную координату для создания полос шириной lineWidth
  // Используем x - y для создания перпендикулярных полос
  const perpendicular = x - y;
  const stripIndex = Math.floor(perpendicular / lineWidth);
  
  // Генерируем seed для взвешенной выборки цвета
  // Цвет меняется и по сегментам, и по полосам
  const colorSeed = (segmentIndex * 73856093) ^ (stripIndex * 19349663);
  
  // Используем взвешенную выборку, чтобы сильные клетки появлялись реже
  return weightedRandomColor(colorSeed);
}

// Функция для получения цвета клетки с использованием серверной логики генерации
function getGeneratedCellColor(pos: CellPosition): string {
  // Проверяем источники случайных цветов
  for (const source of COLOR_SOURCES) {
    const dx = pos.x - source.position.x;
    const dy = pos.y - source.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= 2) {
      return source.color;
    }
  }

  return pseudoRandomColor(pos.x, pos.y);
}

// Компонент миникарты
function MiniMap({
  currentPlayer,
  otherPlayers,
  getCellColor,
  cellColors,
}: {
  currentPlayer: PlayerState;
  otherPlayers: Array<{ id: string; position: CellPosition; color: string; satiety: number; weight: number }>;
  getCellColor: (pos: CellPosition) => string;
  cellColors: Map<string, string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Масштаб: клетки на миникарте должны быть достаточно большими, чтобы быть видными
  // Если на основной карте клетка ~40-60px, то на миникарте делаем 8px для хорошей видимости
  const MAP_SCALE = 8; // Размер клетки на миникарте в пикселях
  // Размер миникарты: показываем область вокруг игрока
  const MAP_SIZE = 500; // Размер миникарты в пикселях

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Очищаем canvas черным фоном
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Центр миникарты (позиция текущего игрока)
    const centerX = currentPlayer.position.x;
    const centerY = currentPlayer.position.y;

    // Радиус видимой области в клетках
    // Показываем примерно 40-50 клеток в каждом направлении для хорошего обзора
    const drawRadius = Math.floor((MAP_SIZE / MAP_SCALE) / 2); // ~41 клетка
    for (let dx = -drawRadius; dx <= drawRadius; dx++) {
      for (let dy = -drawRadius; dy <= drawRadius; dy++) {
        const cellX = centerX + dx;
        const cellY = centerY + dy;
        const key = `${cellX}:${cellY}`;
        
        // Получаем цвет клетки (из cellColors или генерируем на клиенте)
        let cellColor = cellColors.get(key);
        if (!cellColor) {
          // Используем серверную логику генерации цветов для миникарты
          cellColor = getGeneratedCellColor({ x: cellX, y: cellY });
        }
        
        // Позиция на миникарте
        const mapX = MAP_SIZE / 2 + (dx * MAP_SCALE);
        const mapY = MAP_SIZE / 2 + (dy * MAP_SCALE);
        
        // Рисуем клетку только если она в пределах canvas
        if (mapX >= -MAP_SCALE && mapX < MAP_SIZE + MAP_SCALE && mapY >= -MAP_SCALE && mapY < MAP_SIZE + MAP_SCALE) {
          // Рисуем ВСЕ клетки с их реальными цветами - это уменьшенная копия главного поля
          ctx.fillStyle = cellColor;
          // Рисуем квадрат размером MAP_SCALE x MAP_SCALE пикселей
          ctx.fillRect(Math.floor(mapX), Math.floor(mapY), MAP_SCALE, MAP_SCALE);
        }
      }
    }

    // Рисуем других игроков
    otherPlayers.forEach((player) => {
      const dx = player.position.x - centerX;
      const dy = player.position.y - centerY;
      const mapX = MAP_SIZE / 2 + (dx * MAP_SCALE);
      const mapY = MAP_SIZE / 2 + (dy * MAP_SCALE);

      if (mapX >= 0 && mapX < MAP_SIZE && mapY >= 0 && mapY < MAP_SIZE) {
        // Рисуем точку игрока (больше, так как клетки стали больше)
        ctx.fillStyle = player.color || '#ffffff';
        ctx.beginPath();
        ctx.arc(mapX, mapY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });

    // Рисуем текущего игрока (в центре, больше и ярче)
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(MAP_SIZE / 2, MAP_SIZE / 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Рисуем рамку
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);
  }, [currentPlayer, otherPlayers, getCellColor, cellColors]);

  return (
    <div className="minimap-container">
      <canvas
        ref={canvasRef}
        width={MAP_SIZE}
        height={MAP_SIZE}
        className="minimap-canvas"
      />
      <div className="minimap-legend">
        <div className="minimap-legend-item">
          <span className="minimap-legend-dot" style={{ backgroundColor: '#00ff00' }}></span>
          <span>Вы</span>
        </div>
        <div className="minimap-legend-item">
          <span className="minimap-legend-dot" style={{ backgroundColor: '#ffffff' }}></span>
          <span>Игроки</span>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [cellColors, setCellColors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [whiteCellTaps, setWhiteCellTaps] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [colorCellProgress, setColorCellProgress] = useState<
    Map<string, { progress: number; required: number }>
  >(() => new Map());
  const [cellHealth, setCellHealth] = useState<Map<string, number>>(() => new Map());
  const [sidebarTab, setSidebarTab] = useState<'map' | 'inventory' | 'leaderboard' | 'chat' | 'cell-info' | 'stats' | 'help' | 'local-chat'>('map');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [localChat, setLocalChat] = useState<LocalChatData | null>(null);
  const [localChatInput, setLocalChatInput] = useState('');
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(true);
  const resourceCollectedCallbackRef = useRef<((position: CellPosition, amount: number) => void) | null>(null);
  const insufficientPowerCallbackRef = useRef<((position: CellPosition, cellPower: number) => void) | null>(null);
  const [insufficientPowerMessage, setInsufficientPowerMessage] = useState<{ position: CellPosition; cellPower: number; timestamp: number } | null>(null);
  const insufficientInventoryCallbackRef = useRef<((position: CellPosition) => void) | null>(null);
  const [insufficientInventoryMessage, setInsufficientInventoryMessage] = useState<{ position: CellPosition; timestamp: number } | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    // Проверяем сохраненный ID игрока
    const savedPlayerId = localStorage.getItem('playerId');
    
    const s = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
    });
    setSocket(s);

    // Если есть сохраненный ID, отправляем его на сервер для восстановления
    if (savedPlayerId) {
      s.once('connect', () => {
        s.emit('player:restore', { playerId: savedPlayerId });
      });
    }

    s.on('state:init', (payload: any) => {
      // Сохраняем ID игрока в localStorage
      if (payload.player?.id) {
        localStorage.setItem('playerId', payload.player.id);
      }
      setPlayer(payload.player);
      setPlayers(payload.players);
      setLeaderboard(payload.leaderboard);
      setChatMessages(payload.chat);
      // Не открываем модальное окно автоматически - игрок сам откроет по клику
      setUpgradeModalVisible(false);
    });

    s.on(
      'cells:viewport',
      (payload: {
        center: CellPosition;
        radius: number;
        cells: { position: CellPosition; color: string }[];
      }) => {
        setCellColors((prev) => {
          const next = new Map(prev);
          for (const cell of payload.cells) {
            const key = `${cell.position.x}:${cell.position.y}`;
            next.set(key, cell.color);
          }
          return next;
        });
      },
    );

    s.on('players:update', (list: PlayerState[]) => {
      setPlayers(list);
      // Обновляем текущего игрока из списка по сохраненному ID
      const savedPlayerId = localStorage.getItem('playerId');
      if (savedPlayerId) {
        const self = list.find((p) => p.id === savedPlayerId);
        if (self) {
          setPlayer(self);
        }
      } else if (player) {
        // Если не нашли по сохраненному ID, ищем по текущему player.id
        const updated = list.find((p) => p.id === player.id);
        if (updated) {
          setPlayer(updated);
        }
      }
    });

    s.on('cell:updated', (data: { position: CellPosition; color: string }) => {
      const key = `${data.position.x}:${data.position.y}`;
      
      // Обновляем цвет клетки
      setCellColors((prev) => {
        const next = new Map(prev);
        next.set(key, data.color);
        return next;
      });
      
      // Если клетка стала белой - сбрасываем прогресс тапа и здоровье
      if (data.color === '#ffffff') {
        setColorCellProgress((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        setCellHealth((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      } else {
        // Если клетка больше не белая - сбрасываем счетчик тапов белых клеток
        setWhiteCellTaps((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }
    });

    s.on('chat:new', (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-49), msg]);
    });

    s.on('leaderboard:update', (entries: LeaderboardEntry[]) => {
      setLeaderboard(entries);
    });

    s.on(
      'color:cell:progress',
      (data: {
        position: CellPosition;
        progress: number;
        required: number;
        color: string;
        health?: number;
      }) => {
        const key = `${data.position.x}:${data.position.y}`;
        setColorCellProgress((prev) => {
          const next = new Map(prev);
          if (data.progress > 0 && data.required > 0) {
            next.set(key, { progress: data.progress, required: data.required });
          } else {
            next.delete(key);
          }
          return next;
        });
        if (data.health !== undefined) {
          setCellHealth((prev) => {
            const next = new Map(prev);
            if (data.health! > 0) {
              next.set(key, data.health!);
            } else {
              next.delete(key);
            }
            return next;
          });
        }
      },
    );

    s.on('cell:health:update', (data: { position: CellPosition; health: number }) => {
      const key = `${data.position.x}:${data.position.y}`;
      setCellHealth((prev) => {
        const next = new Map(prev);
        if (data.health > 0) {
          next.set(key, data.health);
        } else {
          next.delete(key);
        }
        return next;
      });
    });

    s.on('inventory:used', () => {
      // Обновление сытости и опыта произойдет через players:update
    });

    s.on('local:chat:update', (data: LocalChatData) => {
      // Если нет участников (кроме самого игрока), очищаем локальный чат
      if (data.participants.filter(p => p.id !== player?.id).length === 0) {
        setLocalChat(null);
      } else {
        setLocalChat(data);
      }
    });

    s.on('local:chat:message', (message: LocalChatMessage) => {
      setLocalChat((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          messages: [...prev.messages, message].slice(-50),
        };
      });
    });

    // Обработка события сбора ресурсов для анимации
    s.on('resource:collected', (data: { position: CellPosition; amount: number; color: string }) => {
      if (resourceCollectedCallbackRef.current) {
        resourceCollectedCallbackRef.current(data.position, data.amount);
      }
    });

    // Обработка результата применения улучшения
    s.on('player:upgrade:result', (data: { success: boolean; message?: string }) => {
      if (data.success) {
        // Закрываем модальное окно после успешного применения улучшения
        setUpgradeModalVisible(false);
      }
    });

    s.on('player:name:change:result', (result: { success: boolean; message?: string }) => {
      if (result.success) {
        setIsEditingName(false);
        setEditingName('');
      } else {
        alert(result.message || 'Ошибка при изменении имени');
      }
    });

    return () => {
      s.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const me = useMemo(
    () => players.find((p) => p.id === player?.id) ?? player,
    [players, player],
  );

  const handleMove = (dx: number, dy: number) => {
    if (!socket || !me) return;
    const newPos = { x: me.position.x + dx, y: me.position.y + dy };
    // Позиция обновляется только по данным с сервера (players:update)
    socket.emit('player:move', { position: newPos });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'w') handleMove(0, -1);
      if (e.key === 'ArrowDown' || e.key === 's') handleMove(0, 1);
      if (e.key === 'ArrowLeft' || e.key === 'a') handleMove(-1, 0);
      if (e.key === 'ArrowRight' || e.key === 'd') handleMove(1, 0);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const getCellColor = useCallback((pos: CellPosition): string => {
    const key = `${pos.x}:${pos.y}`;
    const color = cellColors.get(key);
    if (color) return color;
    // Цвет ещё не загружен с сервера — временно рисуем тёмный
    return '#020617';
  }, [cellColors]);

  const handleCellClick = (pos: CellPosition, isAction: boolean = false) => {
    if (!socket || !me) return;
    
    // Выделяем клетку (всегда показываем информацию)
    setSelectedCell(pos);
    
    // Тап (действие) отправляем на сервер только если это действие и клетка соседняя
    if (!isAction) {
      // Просто просмотр - не отправляем тап на сервер
      return;
    }
    
    const key = `${pos.x}:${pos.y}`;
    const cellColor = getCellColor(pos);

    // Если клетка белая - тапаем по ней
    if (cellColor === '#ffffff') {
      const currentTaps = whiteCellTaps.get(key) ?? 0;
      setWhiteCellTaps((prev) => {
        const next = new Map(prev);
        next.set(key, currentTaps + 1);
        return next;
      });
      socket.emit('white:cell:tap', { position: pos });
    } else {
      // Проверяем, достаточно ли силы сбора для тапа (новая формула)
      const cellPower = getCellPower(cellColor);
      const multiplier = (me.power / 2) + (me.stamina / 2) - (me.defense ?? 0);
      const safeMultiplier = Math.max(0.1, multiplier);
      const requiredPower = me.collectionPower * safeMultiplier;
      
      if (cellPower >= requiredPower) {
        // Недостаточно силы сбора - показываем сообщение на карте
        if (insufficientPowerCallbackRef.current) {
          insufficientPowerCallbackRef.current(pos, cellPower);
        }
        // Также сохраняем для отображения в сайдбаре
        setInsufficientPowerMessage({
          position: pos,
          cellPower,
          timestamp: Date.now(),
        });
        // Убираем сообщение через 3 секунды
        setTimeout(() => {
          setInsufficientPowerMessage((prev) => {
            if (prev && prev.position.x === pos.x && prev.position.y === pos.y) {
              return null;
            }
            return prev;
          });
        }, 3000);
        return;
      }
      
      // Проверяем, есть ли место в инвентаре
      const minItemWeight = getItemWeight(cellColor, 1);
      const currentWeight = getInventoryWeight(me.inventory);
      const maxWeight = getMaxInventoryWeight(me.weight, me.stamina);
      
      if (currentWeight + minItemWeight > maxWeight) {
        // Нет места в инвентаре - показываем сообщение на карте
        if (insufficientInventoryCallbackRef.current) {
          insufficientInventoryCallbackRef.current(pos);
        }
        // Также сохраняем для отображения в сайдбаре
        setInsufficientInventoryMessage({
          position: pos,
          timestamp: Date.now(),
        });
        // Убираем сообщение через 3 секунды
        setTimeout(() => {
          setInsufficientInventoryMessage((prev) => {
            if (prev && prev.position.x === pos.x && prev.position.y === pos.y) {
              return null;
            }
            return prev;
          });
        }, 3000);
        return;
      }
      
      // Все цветные клетки собираются через тапы
      socket.emit('color:cell:tap', { position: pos });
      // Запрашиваем прогресс
      socket.emit('color:cell:progress:get', { position: pos });
    }
  };

  const handlePlayerClick = (targetId: string) => {
    if (!socket || !me) return;
    socket.emit('player:attack', { targetId });
  };

  const sendChat = () => {
    if (!socket || !chatInput.trim()) return;
    socket.emit('chat:send', { text: chatInput.trim() });
    setChatInput('');
  };

  const useInventoryItem = (color: string, useType: 'satiety' | 'experience') => {
    if (!socket) return;
    socket.emit('inventory:use', { color, useType });
  };

  const sendLocalChat = () => {
    if (!socket || !me || !localChatInput.trim() || !localChat) return;
    socket.emit('local:chat:send', {
      text: localChatInput.trim(),
      position: me.position,
    });
    setLocalChatInput('');
  };

  // Запрашиваем обновление личного чата при изменении позиции
  useEffect(() => {
    if (socket && me) {
      socket.emit('local:chat:get', { position: me.position });
    }
  }, [socket, me?.position.x, me?.position.y]);

  const applyUpgrade = (upgradeType: 'weight' | 'stamina' | 'collectionPower' | 'power' | 'maxHealth' | 'defense' | 'luck' | 'regeneration') => {
    if (!socket) return;
    socket.emit('player:upgrade', { upgradeType });
  };

  const otherPlayers = useMemo(
    () =>
      players
        .filter((p) => p.id !== me?.id)
        .map((p) => ({
          id: p.id,
          position: p.position,
          color: p.unlockedColors[0] ?? '#ffffff',
          satiety: p.satiety,
          weight: p.weight,
          name: p.name,
        })),
    [players, me],
  );

  // Сортируем инвентарь только при открытии вкладки инвентаря
  const sortedInventory = useMemo(() => {
    if (!me || sidebarTab !== 'inventory') {
      return [];
    }
    return Object.entries(me.inventory)
      .filter(([, count]) => count > 0) // Фильтруем цвета с количеством больше 0
      .sort(([, countA], [, countB]) => countB - countA); // Сортировка по убыванию количества
  }, [me?.inventory, sidebarTab]);

  const renderSidebarContent = () => {
    switch (sidebarTab) {
      case 'inventory':
  return (
          <section className="sidebar-section">
            <h2>Инвентарь</h2>
            {me ? (
              <>
                <div style={{ marginBottom: '12px', padding: '8px', backgroundColor: '#1e293b', borderRadius: '4px' }}>
                  <div style={{ fontSize: '14px', color: '#94a3b8' }}>
                    Вес инвентаря: <span style={{ color: getInventoryWeight(me.inventory) > getMaxInventoryWeight(me.weight, me.stamina) ? '#f87171' : '#22c55e' }}>
                      {getInventoryWeight(me.inventory)} / {getMaxInventoryWeight(me.weight, me.stamina)}
                    </span>
      </div>
                </div>
                <ul className="inventory-list">
                  {sortedInventory.map(([color, count]) => {
                    const satietyRestore = getGreenComponent(color);
                    const cellPower = getCellPower(color);
                    const { b } = getRGBComponents(color);
                    const itemWeight = getItemWeight(color, count);
                    const singleItemWeight = getItemWeight(color, 1);
                    return (
                      <li key={color} className="inventory-item">
                        <span
                          className="color-dot"
                          style={{ backgroundColor: color }}
                        />
                        <span className="inventory-count">{count}</span>
                        <span className="inventory-power">Сила: {cellPower}</span>
                        <span className="inventory-weight" style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '8px' }}>
                          Вес: {itemWeight} (1 шт. = {singleItemWeight.toFixed(2)})
                        </span>
                        <div className="inventory-item-actions">
                          <button
                            className="use-item-button use-satiety-button"
                            onClick={() => useInventoryItem(color, 'satiety')}
                            disabled={count <= 0}
                            title={`Восстановить ${satietyRestore} сытости`}
                          >
                            🍖 +{satietyRestore}
        </button>
                          <button
                            className="use-item-button use-experience-button"
                            onClick={() => useInventoryItem(color, 'experience')}
                            disabled={count <= 0}
                            title={`Получить ${b} опыта`}
                          >
                            ⭐ +{b}
                          </button>
      </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div>Загрузка...</div>
            )}
          </section>
        );
      case 'leaderboard':
        return (
          <section className="sidebar-section">
            <h2>Лидерборд</h2>
            <ol>
              {leaderboard.map((entry) => {
                // Форматируем время игры
                const hours = Math.floor(entry.playTime / 3600);
                const minutes = Math.floor((entry.playTime % 3600) / 60);
                const seconds = entry.playTime % 60;
                const playTimeStr = hours > 0 
                  ? `${hours}ч ${minutes}м`
                  : minutes > 0
                  ? `${minutes}м ${seconds}с`
                  : `${seconds}с`;
                
                return (
                  <li key={entry.playerId}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 'bold' }}>{entry.name}</span>
                        <span style={{ color: entry.isOnline ? '#22c55e' : '#94a3b8', fontSize: '12px' }}>
                          {entry.isOnline ? '🟢' : '⚫'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '12px', color: '#94a3b8' }}>
                        <span>Lv.{entry.level}</span>
                        <span>⏱️ {playTimeStr}</span>
                        <span style={{ color: '#e5e7eb', fontWeight: 'bold' }}>{entry.totalCollected}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      case 'chat':
        return (
          <section className="sidebar-section chat">
            <h2>Чат</h2>
            <div className="chat-messages">
              {chatMessages.map((m) => (
                <div key={m.id} className="chat-message">
                  <strong>{m.name}:</strong> {m.text}
                </div>
              ))}
            </div>
            <div className="chat-input">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Напишите сообщение..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendChat();
                }}
              />
              <button onClick={sendChat}>Отправить</button>
            </div>
          </section>
        );
      case 'cell-info':
        if (!selectedCell) {
          return (
            <section className="sidebar-section">
              <h2>Информация о клетке</h2>
              <div style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', padding: '20px' }}>
                Выберите клетку на карте, чтобы увидеть её информацию
              </div>
            </section>
          );
        }
        return (
          <section className="sidebar-section cell-info">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h2>Информация о клетке</h2>
              <button
                className="cell-info-close-small"
                onClick={() => setSelectedCell(null)}
                title="Закрыть"
              >
                ×
              </button>
            </div>
            <div className="cell-info-content">
              <div className="cell-info-item">
                <span className="cell-info-label">Позиция:</span>
                <span className="cell-info-value">({selectedCell.x}, {selectedCell.y})</span>
              </div>
              {(() => {
                const cellColor = getCellColor(selectedCell);
                const key = `${selectedCell.x}:${selectedCell.y}`;
                const health = cellHealth.get(key);
                const progress = colorCellProgress.get(key);
                const { r, g, b } = getRGBComponents(cellColor);
                const cellPower = getCellPower(cellColor);
                const satietyRestore = getGreenComponent(cellColor);
                const experienceGain = b;
                // Показываем диапазон возможных значений: от 1 до ceil(r/32)
                const maxAmount = Math.max(1, Math.ceil(r / 32));
                const collectedAmountRange = maxAmount > 1 ? `1-${maxAmount}` : '1';
                const isInCollection = me?.unlockedColors.includes(cellColor) ?? false;

  return (
    <>
                    <div className="cell-info-item">
                      <span className="cell-info-label">Цвет:</span>
                      <span 
                        className="cell-info-value"
                        style={{ 
                          display: 'inline-block',
                          width: '24px',
                          height: '24px',
                          backgroundColor: cellColor,
                          border: '2px solid #fff',
                          borderRadius: '4px',
                          verticalAlign: 'middle',
                          marginLeft: '8px'
                        }}
                      />
                      <span className="cell-info-value" style={{ marginLeft: '8px' }}>
                        {cellColor}
                      </span>
                    </div>
                    <div className="cell-info-item">
                      <span className="cell-info-label">RGB:</span>
                      <span className="cell-info-value">
                        R: {r}, G: {g}, B: {b}
                      </span>
                    </div>
                    {health !== undefined && (
                      <div className="cell-info-item">
                        <span className="cell-info-label">Здоровье:</span>
                        <span className="cell-info-value">{health}</span>
                      </div>
                    )}
                    {progress && progress.progress > 0 && (
                      <div className="cell-info-item">
                        <span className="cell-info-label">Прогресс тапа:</span>
                        <span className="cell-info-value">
                          {progress.progress} / {progress.required}
                        </span>
                      </div>
                    )}
                    <div className="cell-info-item">
                      <span className="cell-info-label">Сила клетки:</span>
                      <span className="cell-info-value">{cellPower}</span>
                      {me && cellPower >= me.collectionPower * 5 && (
                        <span 
                          className="cell-info-warning"
                          style={{
                            marginLeft: '8px',
                            color: '#f87171',
                            fontSize: '12px',
                            opacity: insufficientPowerMessage && 
                              insufficientPowerMessage.position.x === selectedCell.x && 
                              insufficientPowerMessage.position.y === selectedCell.y
                              ? 1
                              : 0,
                            transition: 'opacity 0.3s ease-out',
                          }}
                        >
                          (Недостаточно силы сбора)
                        </span>
                      )}
                    </div>
                    {cellColor !== '#ffffff' && (
                      <>
                        <div className="cell-info-item">
                          <span className="cell-info-label">Восстановит сытости:</span>
                          <span className="cell-info-value">+{satietyRestore}</span>
                        </div>
                        <div className="cell-info-item">
                          <span className="cell-info-label">Даст опыта:</span>
                          <span className="cell-info-value">+{experienceGain}</span>
                        </div>
                        <div className="cell-info-item">
                          <span className="cell-info-label">Кол-во при сборе:</span>
                          <span className="cell-info-value">{collectedAmountRange} (случайное)</span>
                        </div>
                        <div className="cell-info-item">
                          <span className="cell-info-label">В коллекции:</span>
                          <span className="cell-info-value" style={{ color: isInCollection ? '#4ade80' : '#f87171' }}>
                            {isInCollection ? 'Да' : 'Нет'}
                          </span>
                        </div>
                      </>
                    )}
                    {cellColor === '#ffffff' && (
                      <div className="cell-info-item">
                        <span className="cell-info-label">Тип:</span>
                        <span className="cell-info-value">Белая клетка (можно тапать 10 раз)</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </section>
        );
      case 'stats':
        if (!me) {
          return (
            <section className="sidebar-section">
              <h2>Параметры игрока</h2>
              <div>Загрузка...</div>
            </section>
          );
        }
        return (
          <section className="sidebar-section">
            <h2>Параметры игрока</h2>
            <div className="player-stats-full">
              <div className="stat-item">
                <span className="stat-label">Сытость:</span>
                <div className="stat-bar">
                  <div
                    className="stat-bar-fill"
                    style={{
                      width: `${(me.satiety / me.weight) * 100}%`,
                      backgroundColor:
                        me.satiety > me.weight * 0.5
                          ? '#22c55e'
                          : me.satiety > me.weight * 0.25
                            ? '#f59e0b'
                            : '#ef4444',
                    }}
                  />
                </div>
                <span className="stat-value">{me.satiety}/{me.weight}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Вес:</span>
                <span className="stat-value">{me.weight}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Выносливость:</span>
                <span className="stat-value">{me.stamina}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Сила сбора:</span>
                <span className="stat-value">{me.collectionPower}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Множитель сбора:</span>
                <span className="stat-value">
                  {(() => {
                    const multiplier = (me.power / 2) + (me.stamina / 2) - (me.defense ?? 0);
                    const safeMultiplier = Math.max(0.1, multiplier);
                    return safeMultiplier.toFixed(2);
                  })()}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Макс. сила клетки:</span>
                <span className="stat-value">
                  {(() => {
                    const multiplier = (me.power / 2) + (me.stamina / 2) - (me.defense ?? 0);
                    const safeMultiplier = Math.max(0.1, multiplier);
                    const maxCellPower = Math.floor(me.collectionPower * safeMultiplier - 1);
                    return maxCellPower;
                  })()}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Сытость на ход:</span>
                <span className="stat-value">
                  {(() => {
                    const difference = Math.max(0, me.collectionPower - me.stamina);
                    const moveCost = Math.max(1, Math.round(me.weight * 0.01 * difference));
                    return moveCost;
                  })()}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Опыт:</span>
                <span className="stat-value">{me.experience}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Сила:</span>
                <span className="stat-value">{me.power}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Здоровье:</span>
                <span className="stat-value">{me.health ?? 100}/{me.maxHealth ?? 100}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Защита:</span>
                <span className="stat-value">{me.defense ?? 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Удача:</span>
                <span className="stat-value">{me.luck ?? 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Регенерация:</span>
                <span className="stat-value">{me.regeneration ?? 0}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Уровень:</span>
                <span className="stat-value">{me.level}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Опыт до след. уровня:</span>
                <span className="stat-value">
                  {me.experience}/{me.level * 255}
                </span>
              </div>
              {me.availableUpgrades > 0 && (
                <div className="stat-item upgrades-available">
                  <span className="stat-label" style={{ color: '#ffd700' }}>
                    Доступно улучшений: {me.availableUpgrades}
                  </span>
                </div>
              )}
            </div>
          </section>
        );
      case 'help':
        return (
          <section className="sidebar-section">
            <h2>Помощь</h2>
            <div className="help-content" style={{ 
              fontSize: '13px', 
              lineHeight: '1.6', 
              color: '#e5e7eb',
              maxHeight: '70vh',
              overflowY: 'auto',
              paddingRight: '8px'
            }}>
              <h3 style={{ marginTop: '16px', marginBottom: '8px', color: '#38bdf8' }}>Правила расчетов параметров игрока</h3>
              
              <h4 style={{ marginTop: '12px', marginBottom: '6px', color: '#60a5fa' }}>Текущие параметры</h4>
              
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>1. satiety (Сытость)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: число от 0 до weight</li>
                  <li>Начальное значение: 255</li>
                  <li>Тратится при движении: satiety -= stamina за каждый ход</li>
                  <li>Восстанавливается при использовании ресурсов: satiety += greenComponent (зеленый компонент HEX цвета)</li>
                  <li>Если satiety &lt;= 0, игрок не может двигаться</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>2. weight (Вес / Максимальная сытость)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: число, минимум 255</li>
                  <li>Начальное значение: 255</li>
                  <li>При улучшении: увеличивается на 10%</li>
                  <li>Влияет на максимальный вес инвентаря: maxInventoryWeight = (weight / 2) + (weight / 2 * stamina / 10)</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>3. stamina (Выносливость)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: целое число, минимум 1</li>
                  <li>Начальное значение: 5</li>
                  <li>Определяет, сколько satiety тратится за один ход: satiety -= stamina</li>
                  <li>При улучшении: увеличивается на 1</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>4. collectionPower (Сила сбора)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: целое число, минимум 1</li>
                  <li>Начальное значение: 10</li>
                  <li>Используется для проверки возможности сбора: player.collectionPower * 5 &gt;= cellPower</li>
                  <li>При улучшении: увеличивается на 1</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>5. experience (Опыт)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: число, минимум 0</li>
                  <li>Начальное значение: 0</li>
                  <li>Получается при использовании ресурсов: experience += blueComponent (синий компонент HEX цвета)</li>
                  <li>Требуется для повышения уровня: requiredExperience = level * 255</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>6. power (Сила атаки)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: целое число, минимум 1</li>
                  <li>Начальное значение: 1</li>
                  <li>Определяет урон при атаке: damage = power</li>
                  <li>При улучшении: увеличивается на 1</li>
                  <li>Урон вычитается из satiety и health цели</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>7. level (Уровень)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: целое число, минимум 1</li>
                  <li>Начальное значение: 1</li>
                  <li>Повышается при накоплении опыта: requiredExperience = level * 255</li>
                  <li>При повышении уровня: level += 1, availableUpgrades += 1</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>8. availableUpgrades (Доступные улучшения)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: целое число, минимум 0</li>
                  <li>Увеличивается при повышении уровня</li>
                  <li>Позволяет улучшить один из параметров</li>
                </ul>
              </div>

              <h4 style={{ marginTop: '16px', marginBottom: '6px', color: '#60a5fa' }}>Дополнительные параметры</h4>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>9. health (Здоровье)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: число от 0 до maxHealth</li>
                  <li>Начальное значение: 100</li>
                  <li>Тратится при получении урона: health = Math.max(0, health - damage)</li>
                  <li>Отдельно от satiety, используется для PvP</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>10. maxHealth (Максимальное здоровье)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: число, минимум 100</li>
                  <li>Начальное значение: 100</li>
                  <li>При улучшении: увеличивается на 20%</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>11. defense (Защита)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: целое число, минимум 0</li>
                  <li>Начальное значение: 0</li>
                  <li>Снижает получаемый урон: actualDamage = Math.max(1, damage - defense)</li>
                  <li>При улучшении: увеличивается на 1</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>12. luck (Удача)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: целое число, минимум 0</li>
                  <li>Начальное значение: 0</li>
                  <li>Влияет на количество собираемых ресурсов: bonusAmount = Math.floor(luck / 5)</li>
                  <li>При улучшении: увеличивается на 1</li>
                  <li>Каждые 5 единиц удачи дают +1 к собираемому количеству ресурсов</li>
                </ul>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#fbbf24' }}>13. regeneration (Регенерация)</strong>
                <ul style={{ marginTop: '4px', paddingLeft: '20px' }}>
                  <li>Тип: число, минимум 0</li>
                  <li>Начальное значение: 0</li>
                  <li>Восстанавливает satiety каждые 10 секунд</li>
                  <li>При улучшении: увеличивается на 0.5</li>
                </ul>
              </div>

              <h4 style={{ marginTop: '16px', marginBottom: '6px', color: '#60a5fa' }}>Формулы расчетов</h4>

              <div style={{ marginBottom: '12px', backgroundColor: 'rgba(30, 41, 59, 0.5)', padding: '8px', borderRadius: '6px' }}>
                <strong style={{ color: '#22c55e' }}>Урон при атаке:</strong>
                <pre style={{ marginTop: '4px', fontSize: '11px', overflowX: 'auto' }}>{`damage = power
actualDamage = Math.max(1, damage - target.defense)
target.health -= actualDamage
target.satiety -= actualDamage`}</pre>
              </div>

              <div style={{ marginBottom: '12px', backgroundColor: 'rgba(30, 41, 59, 0.5)', padding: '8px', borderRadius: '6px' }}>
                <strong style={{ color: '#22c55e' }}>Сбор ресурсов:</strong>
                <pre style={{ marginTop: '4px', fontSize: '11px', overflowX: 'auto' }}>{`baseAmount = random(1, ceil(R / 32))
luckBonus = Math.floor(luck / 5)
collectedAmount = baseAmount + luckBonus`}</pre>
              </div>

              <div style={{ marginBottom: '12px', backgroundColor: 'rgba(30, 41, 59, 0.5)', padding: '8px', borderRadius: '6px' }}>
                <strong style={{ color: '#22c55e' }}>Вес инвентаря:</strong>
                <pre style={{ marginTop: '4px', fontSize: '11px', overflowX: 'auto' }}>{`itemWeight = (count * G / 16) + (count * B / 32)
totalWeight = sum(itemWeight)
maxWeight = (weight / 2) + (weight / 2 * stamina / 10)`}</pre>
              </div>

              <div style={{ marginBottom: '12px', backgroundColor: 'rgba(30, 41, 59, 0.5)', padding: '8px', borderRadius: '6px' }}>
                <strong style={{ color: '#22c55e' }}>Опыт для уровня:</strong>
                <pre style={{ marginTop: '4px', fontSize: '11px', overflowX: 'auto' }}>{`requiredExperience = level * 255
if (experience >= requiredExperience):
  experience -= requiredExperience
  level += 1
  availableUpgrades += 1`}</pre>
              </div>
            </div>
          </section>
        );
      case 'local-chat':
        if (!localChat || localChat.participants.filter(p => p.id !== me?.id).length === 0) {
          return (
            <section className="sidebar-section">
              <h2>Локальный чат</h2>
              <div style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', padding: '20px' }}>
                На этой клетке нет других игроков
              </div>
            </section>
          );
        }
        return (
          <section className="sidebar-section chat">
            <h2>
              Локальный чат ({localChat.participants.filter(p => p.id !== me?.id).length} других)
            </h2>
            <div className="local-chat-participants" style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {localChat.participants
                .filter(p => p.id !== me?.id)
                .map((p) => (
                  <span key={p.id} className="participant-badge" style={{ 
                    padding: '4px 8px', 
                    backgroundColor: '#1e293b', 
                    borderRadius: '4px', 
                    fontSize: '12px',
                    border: '1px solid rgba(148, 163, 184, 0.3)'
                  }}>
                    {p.name}
                  </span>
                ))}
            </div>
            <div className="chat-messages">
              {localChat.messages.map((m) => (
                <div key={m.id} className="chat-message">
                  <strong>{m.name}:</strong> {m.text}
                </div>
              ))}
            </div>
            <div className="chat-input">
              <input
                value={localChatInput}
                onChange={(e) => setLocalChatInput(e.target.value)}
                placeholder="Напишите сообщение..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendLocalChat();
                }}
              />
              <button onClick={sendLocalChat}>Отправить</button>
            </div>
          </section>
        );
      case 'map':
      default:
        return (
          <section className="sidebar-section">
            <h2>Карта</h2>
            {me && (
              <MiniMap
                currentPlayer={me}
                otherPlayers={otherPlayers}
                getCellColor={getCellColor}
                cellColors={cellColors}
              />
            )}
          </section>
        );
    }
  };

  return (
    <div className="app-root">
      <div className="top-bar">
        {me && (
          <div className="player-info-container">
            <div className="player-name-experience-row">
              {isEditingName ? (
                <div className="stat-icon player-name-edit">
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (editingName.trim()) {
                          socket?.emit('player:name:change', { newName: editingName.trim() });
                        } else {
                          setIsEditingName(false);
                          setEditingName('');
                        }
                      } else if (e.key === 'Escape') {
                        setIsEditingName(false);
                        setEditingName('');
                      }
                    }}
                    onBlur={() => {
                      if (editingName.trim()) {
                        socket?.emit('player:name:change', { newName: editingName.trim() });
                      } else {
                        setIsEditingName(false);
                        setEditingName('');
                      }
                    }}
                    autoFocus
                    className="name-input"
                    maxLength={50}
                  />
                </div>
              ) : (
                <div 
                  className="stat-icon player-name-display"
                  onClick={() => {
                    setEditingName(me.name);
                    setIsEditingName(true);
                  }}
                  title="Нажмите, чтобы изменить имя"
                  style={{ cursor: 'pointer' }}
                >
                  <span className="stat-icon-emoji">👤</span>
                  <span className="stat-icon-value">{me.name}</span>
                </div>
              )}
              <div 
                className={`stat-icon ${me.availableUpgrades > 0 ? 'upgrades-available-clickable' : ''}`}
                onClick={() => {
                  if (me.availableUpgrades > 0) {
                    setUpgradeModalVisible(true);
                  }
                }}
                style={me.availableUpgrades > 0 ? { cursor: 'pointer' } : {}}
                title={me.availableUpgrades > 0 ? `Доступно улучшений: ${me.availableUpgrades}. Нажмите, чтобы открыть` : 'Уровень'}
              >
                <span className="stat-icon-emoji">📈</span>
                <span className="stat-icon-value">Lv.{me.level}</span>
              </div>
              <div 
                className={`stat-icon ${me.availableUpgrades > 0 ? 'upgrades-available-clickable' : ''}`}
                onClick={() => {
                  if (me.availableUpgrades > 0) {
                    setUpgradeModalVisible(true);
                  }
                }}
                style={me.availableUpgrades > 0 ? { cursor: 'pointer' } : {}}
                title={me.availableUpgrades > 0 ? `Доступно улучшений: ${me.availableUpgrades}. Нажмите, чтобы открыть` : 'Опыт'}
              >
                <span className="stat-icon-emoji">⭐</span>
                <span className="stat-icon-value">{me.experience}/{me.level * 255}</span>
              </div>
              <div 
                className={`stat-icon ${me.availableUpgrades > 0 ? 'upgradeable' : ''}`} 
                title={me.availableUpgrades > 0 ? "Сытость (можно улучшить вес)" : "Сытость"}
                onClick={me.availableUpgrades > 0 ? () => setUpgradeModalVisible(true) : undefined}
                style={me.availableUpgrades > 0 ? { cursor: 'pointer' } : {}}
              >
                <span className="stat-icon-emoji">🍖</span>
                <span className="stat-icon-value">{me.satiety}/{me.weight}</span>
              </div>
              <div className="stat-icon" title={`Вместительность инвентаря: ${getInventoryWeight(me.inventory)} / ${getMaxInventoryWeight(me.weight, me.stamina)}`}>
                <span className="stat-icon-emoji">🎒</span>
                <span className="stat-icon-value" style={{
                  color: getInventoryWeight(me.inventory) > getMaxInventoryWeight(me.weight, me.stamina) ? '#f87171' : undefined
                }}>
                  {getInventoryWeight(me.inventory)}/{getMaxInventoryWeight(me.weight, me.stamina)}
                </span>
              </div>
            </div>
            <div className="player-stats-compact">
              <div 
                className={`stat-icon ${me.availableUpgrades > 0 ? 'upgradeable' : ''}`} 
                title={me.availableUpgrades > 0 ? "Выносливость (можно улучшить)" : "Выносливость"}
                onClick={me.availableUpgrades > 0 ? () => setUpgradeModalVisible(true) : undefined}
                style={me.availableUpgrades > 0 ? { cursor: 'pointer' } : {}}
              >
                <span className="stat-icon-emoji">⚡</span>
                <span className="stat-icon-value">{me.stamina}</span>
              </div>
              <div 
                className={`stat-icon ${me.availableUpgrades > 0 ? 'upgradeable' : ''}`} 
                title={me.availableUpgrades > 0 ? "Сила сбора (можно улучшить)" : "Сила сбора"}
                onClick={me.availableUpgrades > 0 ? () => setUpgradeModalVisible(true) : undefined}
                style={me.availableUpgrades > 0 ? { cursor: 'pointer' } : {}}
              >
                <span className="stat-icon-emoji">🔨</span>
                <span className="stat-icon-value">{me.collectionPower}</span>
              </div>
              <div 
                className={`stat-icon ${me.availableUpgrades > 0 ? 'upgradeable' : ''}`} 
                title={me.availableUpgrades > 0 ? "Сила (можно улучшить)" : "Сила"}
                onClick={me.availableUpgrades > 0 ? () => setUpgradeModalVisible(true) : undefined}
                style={me.availableUpgrades > 0 ? { cursor: 'pointer' } : {}}
              >
                <span className="stat-icon-emoji">💪</span>
                <span className="stat-icon-value">{me.power}</span>
              </div>
              <div 
                className={`stat-icon ${me.availableUpgrades > 0 ? 'upgradeable' : ''}`} 
                title={me.availableUpgrades > 0 ? "Удача (можно улучшить)" : "Удача"}
                onClick={me.availableUpgrades > 0 ? () => setUpgradeModalVisible(true) : undefined}
                style={me.availableUpgrades > 0 ? { cursor: 'pointer' } : {}}
              >
                <span className="stat-icon-emoji">🍀</span>
                <span className="stat-icon-value">{me.luck ?? 0}</span>
              </div>
              <div 
                className={`stat-icon ${me.availableUpgrades > 0 ? 'upgradeable' : ''}`} 
                title={me.availableUpgrades > 0 ? "Защита (можно улучшить)" : "Защита"}
                onClick={me.availableUpgrades > 0 ? () => setUpgradeModalVisible(true) : undefined}
                style={me.availableUpgrades > 0 ? { cursor: 'pointer' } : {}}
              >
                <span className="stat-icon-emoji">🛡️</span>
                <span className="stat-icon-value">{me.defense ?? 0}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="layout">
        <div className="left-panel">
          <PhaserGame
            playerId={me?.id ?? null}
            playerPosition={me?.position ?? null}
            otherPlayers={otherPlayers}
            getCellColor={getCellColor}
            onCellClick={handleCellClick}
            onPlayerClick={handlePlayerClick}
            onMove={handleMove}
            collectibleColors={me?.unlockedColors ?? []}
            colorCellProgress={colorCellProgress}
            cellHealth={cellHealth}
            playerSatiety={me?.satiety}
            playerWeight={me?.weight}
            playerCollectionPower={me?.collectionPower}
            playerName={me?.name}
            selectedCell={selectedCell}
            setResourceCollectedCallback={(callback) => {
              resourceCollectedCallbackRef.current = callback;
            }}
            insufficientPowerMessage={insufficientPowerMessage}
            setInsufficientPowerCallback={(callback) => {
              insufficientPowerCallbackRef.current = callback;
            }}
            insufficientInventoryMessage={insufficientInventoryMessage}
            setInsufficientInventoryCallback={(callback) => {
              insufficientInventoryCallbackRef.current = callback;
            }}
          />
        </div>
        <div className={`right-panel desktop-only`}>
          {/* Панель с кнопками для десктопа */}
          <div className="desktop-tab-bar">
            <button
              className={`tab-button ${sidebarTab === 'map' ? 'active' : ''}`}
              onClick={() => setSidebarTab('map')}
            >
              🗺️ Карта
            </button>
            <button
              className={`tab-button ${sidebarTab === 'inventory' ? 'active' : ''}`}
              onClick={() => setSidebarTab('inventory')}
            >
              🎒 Инвентарь
            </button>
            <button
              className={`tab-button ${sidebarTab === 'leaderboard' ? 'active' : ''}`}
              onClick={() => setSidebarTab('leaderboard')}
            >
              🏆 Лидерборд
            </button>
            <button
              className={`tab-button ${sidebarTab === 'chat' ? 'active' : ''}`}
              onClick={() => setSidebarTab('chat')}
            >
              💬 Чат
            </button>
            <button
              className={`tab-button ${sidebarTab === 'cell-info' ? 'active' : ''}`}
              onClick={() => setSidebarTab('cell-info')}
              title="Информация о выбранной клетке"
            >
              📊 Клетка
            </button>
            <button
              className={`tab-button ${sidebarTab === 'stats' ? 'active' : ''}`}
              onClick={() => setSidebarTab('stats')}
              title="Параметры игрока"
            >
              ⚙️ Параметры
            </button>
            <button
              className={`tab-button ${sidebarTab === 'help' ? 'active' : ''}`}
              onClick={() => setSidebarTab('help')}
              title="Помощь и правила"
            >
              ❓ Помощь
            </button>
          </div>
          {renderSidebarContent()}
        </div>
      </div>

      {/* Мобильный сайдбар */}
      <div
        className={`mobile-sidebar ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      >
        <div
          className="mobile-sidebar-content"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="sidebar-close"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
          {renderSidebarContent()}
        </div>
      </div>

      {/* Модальное окно для улучшений */}
      {me && me.availableUpgrades > 0 && upgradeModalVisible && (
        <div className="upgrade-modal-overlay" onClick={() => setUpgradeModalVisible(false)}>
          <div className="upgrade-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Выберите улучшение</h2>
            <p>У вас {me.availableUpgrades} доступных улучшений</p>
            <div className="upgrade-options">
              <button
                className="upgrade-button"
                onClick={() => applyUpgrade('weight')}
              >
                <div className="upgrade-title">Вес +10%</div>
                <div className="upgrade-desc">Максимальная сытость увеличится на 10%</div>
              </button>
              <button
                className="upgrade-button"
                onClick={() => applyUpgrade('stamina')}
              >
                <div className="upgrade-title">Выносливость +1</div>
                <div className="upgrade-desc">Тратится больше сытости за ход</div>
              </button>
              <button
                className="upgrade-button"
                onClick={() => applyUpgrade('collectionPower')}
              >
                <div className="upgrade-title">Сила сбора +1</div>
                <div className="upgrade-desc">Больше единиц за тап</div>
              </button>
              <button
                className="upgrade-button"
                onClick={() => applyUpgrade('power')}
              >
                <div className="upgrade-title">Сила +1</div>
                <div className="upgrade-desc">Больше урона при атаке</div>
              </button>
              <button
                className="upgrade-button"
                onClick={() => applyUpgrade('defense')}
              >
                <div className="upgrade-title">Защита +1</div>
                <div className="upgrade-desc">Снижает получаемый урон</div>
              </button>
              <button
                className="upgrade-button"
                onClick={() => applyUpgrade('luck')}
              >
                <div className="upgrade-title">Удача +1</div>
                <div className="upgrade-desc">Каждые 5 единиц дают +1 к сбору ресурсов</div>
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Нижний бар с кнопками для мобильных */}
      <div className="mobile-bottom-bar">
        <button
          className={`bar-button ${sidebarTab === 'map' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('map');
            setSidebarOpen(true);
          }}
          title="Карта"
        >
          <span className="bar-button-icon">🗺️</span>
          <span className="bar-button-text">Карта</span>
        </button>
        <button
          className={`bar-button ${sidebarTab === 'inventory' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('inventory');
            setSidebarOpen(true);
          }}
          title="Инвентарь"
        >
          <span className="bar-button-icon">🎒</span>
          <span className="bar-button-text">Инвентарь</span>
        </button>
        <button
          className={`bar-button ${sidebarTab === 'leaderboard' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('leaderboard');
            setSidebarOpen(true);
          }}
          title="Лидерборд"
        >
          <span className="bar-button-icon">🏆</span>
          <span className="bar-button-text">Лидерборд</span>
        </button>
        <button
          className={`bar-button ${sidebarTab === 'chat' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('chat');
            setSidebarOpen(true);
          }}
          title="Чат"
        >
          <span className="bar-button-icon">💬</span>
          <span className="bar-button-text">Чат</span>
        </button>
        <button
          className={`bar-button ${sidebarTab === 'cell-info' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('cell-info');
            setSidebarOpen(true);
          }}
          title="Информация о выбранной клетке"
        >
          <span className="bar-button-icon">📊</span>
          <span className="bar-button-text">Клетка</span>
        </button>
        <button
          className={`bar-button ${sidebarTab === 'stats' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('stats');
            setSidebarOpen(true);
          }}
          title="Параметры игрока"
        >
          <span className="bar-button-icon">⚙️</span>
          <span className="bar-button-text">Параметры</span>
        </button>
        <button
          className={`bar-button ${sidebarTab === 'help' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('help');
            setSidebarOpen(true);
          }}
          title="Помощь и правила"
        >
          <span className="bar-button-icon">❓</span>
          <span className="bar-button-text">Помощь</span>
        </button>
      </div>

      {/* Иконка для локального чата - показывается если есть другие участники на клетке и чат не открыт */}
      {localChat && 
       localChat.participants.filter(p => p.id !== me?.id).length > 0 && 
       (sidebarTab !== 'local-chat' || !sidebarOpen) && (
        <button
          className="local-chat-toggle-button"
          onClick={() => {
            setSidebarTab('local-chat');
            setSidebarOpen(true);
          }}
          title="Открыть локальный чат"
        >
          💬
          <span className="local-chat-badge">{localChat.participants.filter(p => p.id !== me?.id).length}</span>
        </button>
      )}
    </div>
  );
}

export default App;
