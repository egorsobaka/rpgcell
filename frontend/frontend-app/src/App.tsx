import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';
import { PhaserGame } from './game/PhaserGame';
import { getParamHelp } from './playerParamsHelp';

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
  buildings?: Record<string, number>;
  totalFoodEaten?: number;
  skin?: string;
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
  skin?: string; // URL скина персонажа
}

// Параметры клетки
interface CellParams {
  food: number; // Кол-во еды (0-255, шаг 8)
  building: number; // Кол-во строительных единиц (0-255, шаг 8)
  experience: number; // Кол-во опыта (0-255, шаг 8)
  power: number; // Сила клетки (1-256, влияет на яркость)
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

// Вычисление веса одного элемента инвентаря из параметров
// Вес = (количество * food / 16) + (количество * experience / 32)
function getItemWeightFromParams(params: CellParams, count: number): number {
  return (count * params.food / 16) + (count * params.experience / 32);
}

// Вычисление веса одного элемента инвентаря из цвета (для обратной совместимости)
// Вес = (количество * зеленый компонент / 16) + (количество * синий компонент / 32)
function getItemWeight(color: string, count: number, params?: CellParams): number {
  if (params) {
    return getItemWeightFromParams(params, count);
  }
  const { g, b } = getRGBComponents(color);
  return (count * g / 16) + (count * b / 32);
}

// Вычисление общего веса инвентаря
function getInventoryWeight(inventory: Record<string, number>, cellParamsByColor?: Map<string, CellParams>): number {
  let totalWeight = 0;
  for (const [color, count] of Object.entries(inventory)) {
    if (count > 0) {
      // Пытаемся найти параметры клетки по цвету
      const params = cellParamsByColor?.get(color);
      totalWeight += getItemWeight(color, count, params);
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
  const [characters, setCharacters] = useState<PlayerState[]>([]);
  const [userId] = useState<string>(() => {
    let id = localStorage.getItem('userId');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('userId', id);
    }
    return id;
  });
  const [cellColors, setCellColors] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [cellParams, setCellParams] = useState<Map<string, CellParams>>(
    () => new Map(),
  );
  const [cellConstructionPoints, setCellConstructionPoints] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [cellConstructionTypes, setCellConstructionTypes] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [cellNames, setCellNames] = useState<Map<string, string>>(
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
  const [sidebarTab, setSidebarTab] = useState<'map' | 'inventory' | 'leaderboard' | 'chat' | 'cell-info' | 'stats' | 'help' | 'local-chat' | 'buildings' | 'characters'>('map');
  const [buildings, setBuildings] = useState<Array<{ name: string; structure: any[]; cellPower: number; cellHealth: number }>>([]);
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
  const tapAmountCallbackRef = useRef<((position: CellPosition, amount: number) => void) | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [helpTooltip, setHelpTooltip] = useState<{ param: string; x: number; y: number } | null>(null);
  const [modalMessage, setModalMessage] = useState<{ title: string; message: string } | null>(null);

  const VITE_API_URL = import.meta.env.VITE_API_URL;
  const VITE_API_URL_SOCKET = import.meta.env.VITE_API_URL_SOCKET;


  useEffect(() => {
    // Проверяем сохраненный ID игрока
    const savedPlayerId = localStorage.getItem('playerId');
    console.log('VITE_API_URL', VITE_API_URL);
    console.log('VITE_API_URL_SOCKET', VITE_API_URL_SOCKET);

    const s = io(`${VITE_API_URL_SOCKET}`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
      // Отправляем playerId и userId сразу при подключении, если есть
      auth: savedPlayerId ? { playerId: savedPlayerId, userId } : { userId },
    });
    setSocket(s);

    // Если есть сохраненный ID, отправляем его на сервер для восстановления
    // Отправляем при каждом подключении (включая переподключения)
    const sendPlayerRestore = () => {
      if (savedPlayerId) {
        console.log('Sending player:restore with playerId:', savedPlayerId, 'userId:', userId);
        s.emit('player:restore', { playerId: savedPlayerId, userId });
      }
    };
    
    // Отправляем сразу при подключении (даже если еще не полностью подключен)
    // Socket.IO позволяет отправлять события до полного подключения
    if (savedPlayerId) {
      // Пытаемся отправить сразу
      sendPlayerRestore();
      
      // Также отправляем при полном подключении
      s.once('connect', () => {
        console.log('Socket connected, sending player:restore');
        sendPlayerRestore();
      });
    }
    
    // Также отправляем при переподключении
    s.on('reconnect', () => {
      console.log('Socket reconnected, sending player:restore');
      sendPlayerRestore();
    });

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
        cells: { position: CellPosition; color: string; params?: CellParams; constructionPoints?: number; constructionType?: number; buildingName?: string; buildingId?: string; name?: string }[];
      }) => {
        setCellColors((prev) => {
          const next = new Map(prev);
          for (const cell of payload.cells) {
            const key = `${cell.position.x}:${cell.position.y}`;
            next.set(key, cell.color);
          }
          return next;
        });
        setCellParams((prev) => {
          const next = new Map(prev);
          for (const cell of payload.cells) {
            if (cell.params) {
              const key = `${cell.position.x}:${cell.position.y}`;
              next.set(key, cell.params);
              // Также сохраняем параметры по цвету для использования в инвентаре
              next.set(cell.color, cell.params);
            }
          }
          return next;
        });
        
        // Обновляем названия клеток
        setCellNames((prev) => {
          const next = new Map(prev);
          for (const cell of payload.cells) {
            if (cell.name) {
              const key = `${cell.position.x}:${cell.position.y}`;
              next.set(key, cell.name);
            }
          }
          return next;
        });
        
        // Обновляем строительные очки из payload
        setCellConstructionPoints((prev) => {
          const next = new Map(prev);
          for (const cell of payload.cells) {
            const key = `${cell.position.x}:${cell.position.y}`;
            if (cell.constructionPoints !== undefined && cell.constructionPoints > 0) {
              next.set(key, cell.constructionPoints);
            } else {
              // Удаляем из карты, если клетка больше не является строительным материалом
              next.delete(key);
            }
          }
          return next;
        });
        
        // Обновляем типы строительных материалов из payload
        setCellConstructionTypes((prev) => {
          const next = new Map(prev);
          for (const cell of payload.cells) {
            const key = `${cell.position.x}:${cell.position.y}`;
            // constructionType может быть 0, поэтому проверяем !== undefined и !== null
            if (cell.constructionType !== undefined && cell.constructionType !== null) {
              next.set(key, cell.constructionType);
            } else {
              // Удаляем из карты, если клетка больше не имеет типа
              next.delete(key);
            }
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

    s.on('inventory:dropped', (data: { success: boolean; message?: string; constructionPoints?: number }) => {
      if (!data.success && data.message) {
        setModalMessage({ title: 'Ошибка', message: data.message });
      }
    });

    s.on('buildings:list', (data: Array<{ name: string; structure: any[]; cellPower: number; cellHealth: number }>) => {
      setBuildings(data);
    });

    s.on('building:built', (data: { success: boolean; message?: string }) => {
      if (!data.success && data.message) {
        setModalMessage({ title: 'Ошибка строительства', message: data.message });
      }
    });

    // Запрашиваем список построек при подключении
    s.emit('buildings:list');

    // Обработчики для работы с персонажами
    s.on('characters:list', (data: PlayerState[]) => {
      setCharacters(data);
    });

    s.on('character:switched', (data: { success: boolean; character?: PlayerState; message?: string }) => {
      if (data.success && data.character) {
        setPlayer(data.character);
        localStorage.setItem('playerId', data.character.id);
        // Обновляем список персонажей
        s.emit('characters:list', { userId });
      } else if (data.message) {
        setModalMessage({ title: 'Ошибка', message: data.message });
      }
    });

    s.on('character:created', (data: { success: boolean; character?: PlayerState; message?: string; oldPlayerWeight?: number }) => {
      if (data.success && data.character) {
        setPlayer(data.character);
        localStorage.setItem('playerId', data.character.id);
        // Обновляем вес текущего персонажа, если он был изменен
        if (data.oldPlayerWeight !== undefined && me) {
          setPlayer({ ...me, weight: data.oldPlayerWeight });
        }
        // Обновляем список персонажей
        s.emit('characters:list', { userId });
      } else if (data.message) {
        setModalMessage({ title: 'Ошибка', message: data.message });
      }
    });

    // Запрашиваем список персонажей при подключении
    s.on('connect', () => {
      s.emit('characters:list', { userId });
    });

    s.on('cell:updated', (data: { position: CellPosition; color: string; params?: CellParams; constructionPoints?: number; constructionType?: number; buildingName?: string; buildingId?: string; name?: string }) => {
      const key = `${data.position.x}:${data.position.y}`;
      
      // Обновляем цвет клетки
      setCellColors((prev) => {
        const next = new Map(prev);
        next.set(key, data.color);
        return next;
      });
      
      // Обновляем параметры клетки, если они есть
      if (data.params) {
        setCellParams((prev) => {
          const next = new Map(prev);
          next.set(key, data.params!);
          // Также сохраняем параметры по цвету для использования в инвентаре
          next.set(data.color, data.params!);
          return next;
        });
      }
      
      // Обновляем название клетки
      if (data.name) {
        setCellNames((prev) => {
          const next = new Map(prev);
          next.set(key, data.name!);
          return next;
        });
      } else if (data.color === '#ffffff') {
        // Если клетка стала белой, удаляем название
        setCellNames((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }
      
      // Обновляем строительные очки
      if (data.constructionPoints !== undefined && data.constructionPoints > 0) {
        setCellConstructionPoints((prev) => {
          const next = new Map(prev);
          next.set(key, data.constructionPoints!);
          return next;
        });
        // Обновляем тип строительного материала
        if (data.constructionType !== undefined) {
          setCellConstructionTypes((prev) => {
            const next = new Map(prev);
            next.set(key, data.constructionType!);
            return next;
          });
        }
        // Для серых клеток обновляем здоровье = building * 10
        if (data.params && data.params.building > 0) {
          setCellHealth((prev) => {
            const next = new Map(prev);
            next.set(key, data.params!.building * 10);
            return next;
          });
        }
      } else if (data.color === '#ffffff') {
        // Удаляем строительные очки и тип для белых клеток
        setCellConstructionPoints((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
        setCellConstructionTypes((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }
      
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
        tapAmount?: number;
        insufficientInventory?: boolean;
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
        // Показываем анимацию тапа, если есть tapAmount
        if (data.tapAmount !== undefined && data.tapAmount > 0 && tapAmountCallbackRef.current) {
          tapAmountCallbackRef.current(data.position, data.tapAmount);
        }
        // Показываем сообщение о нехватке места в инвентаре, если сервер вернул этот флаг
        if (data.insufficientInventory && insufficientInventoryCallbackRef.current) {
          insufficientInventoryCallbackRef.current(data.position);
          setInsufficientInventoryMessage({
            position: data.position,
            timestamp: Date.now(),
          });
          // Убираем сообщение через 3 секунды
          setTimeout(() => {
            setInsufficientInventoryMessage((prev) => {
              if (prev && prev.position.x === data.position.x && prev.position.y === data.position.y) {
                return null;
              }
              return prev;
            });
          }, 3000);
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
        setModalMessage({ title: 'Ошибка', message: result.message || 'Ошибка при изменении имени' });
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
      // Получаем параметры клетки по позиции или по цвету
      const cellParamsForPos = cellParams.get(key) ?? cellParams.get(cellColor);
      
      // Проверяем, достаточно ли силы сбора для тапа (новая формула)
      const cellPower = cellParamsForPos?.power ?? getCellPower(cellColor);
      const multiplier = (me.power / 2) + (me.stamina / 2) - (me.defense ?? 0);
      const safeMultiplier = Math.max(0.1, multiplier);
      // Максимальная сила клетки, которую может собрать игрок, не должна быть меньше 1
      const requiredPower = Math.max(1, me.collectionPower * safeMultiplier);
      
      // Клетку можно собирать, если её сила меньше или равна максимальной силе игрока
      if (cellPower > requiredPower) {
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
      const minItemWeight = getItemWeight(cellColor, 1, cellParamsForPos);
      const currentWeight = getInventoryWeight(me.inventory, cellParams);
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
      
      // Проверяем, достаточно ли сытости для тапа
      // Трата сытости: сила сбора - (сила + выносливость + защита)/3
      const foodCost = Math.max(0, Math.ceil(me.collectionPower - (me.power + me.stamina + (me.defense ?? 0)) / 3));
      const roundedSatiety = Math.round(me.satiety);
      
      if (roundedSatiety < foodCost) {
        // Недостаточно сытости - показываем сообщение на карте
        if (insufficientPowerCallbackRef.current) {
          insufficientPowerCallbackRef.current(pos, 0); // Используем существующий callback для визуализации
        }
        // Показываем сообщение в модалке
        setModalMessage({
          title: 'Недостаточно сытости',
          message: `Для тапа нужно ${foodCost} сытости, у вас ${roundedSatiety}. Восстановите сытость, используя ресурсы из инвентаря.`,
        });
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
          skin: p.skin,
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
            {me && (() => {
              const cellColorAtPlayer = getCellColor(me.position);
              const rgb = getRGBComponents(cellColorAtPlayer);
              const isWhite = cellColorAtPlayer === '#ffffff';
              const isGray = rgb.r === rgb.g && rgb.g === rgb.b && cellColorAtPlayer !== '#ffffff';
              return !isWhite && !isGray;
            })() && (
              <div style={{ 
                marginBottom: '12px', 
                padding: '8px', 
                backgroundColor: '#f59e0b', 
                borderRadius: '4px',
                color: '#fff',
                fontSize: '12px',
              }}>
                ⚠️ Встаньте на белую клетку или клетку со строительным материалом для сброса инвентаря
              </div>
            )}
            {me ? (
              <>
                <div style={{ marginBottom: '12px', padding: '8px', backgroundColor: '#1e293b', borderRadius: '4px' }}>
                  <div style={{ fontSize: '14px', color: '#94a3b8' }}>
                    Вес инвентаря: <span style={{ color: getInventoryWeight(me.inventory, cellParams) > getMaxInventoryWeight(me.weight, me.stamina) ? '#f87171' : '#22c55e' }}>
                      {getInventoryWeight(me.inventory, cellParams)} / {getMaxInventoryWeight(me.weight, me.stamina)}
                    </span>
      </div>
                </div>
                <ul className="inventory-list">
                  {sortedInventory.map(([color, count]) => {
                    // Получаем параметры клетки по цвету
                    const params = cellParams.get(color);
                    // Используем параметры, если доступны, иначе вычисляем из цвета (для обратной совместимости)
                    const satietyRestore = params?.food ?? getGreenComponent(color);
                    const cellPower = params?.power ?? getCellPower(color);
                    const experienceGain = params?.experience ?? getRGBComponents(color).b;
                    const buildingAmount = params?.building ?? getRGBComponents(color).r;
                    const itemWeight = getItemWeight(color, count, params);
                    const singleItemWeight = getItemWeight(color, 1, params);
                    // Пытаемся найти название по цвету (может быть несколько клеток с одним цветом, берем первое найденное)
                    // Также можно хранить названия по цвету в отдельной мапе для инвентаря
                    let cellName: string | undefined;
                    // Ищем название в cellNames по позициям
                    for (const [key, name] of cellNames.entries()) {
                      try {
                        const [x, y] = key.split(':').map(Number);
                        const cellColorAtKey = getCellColor({ x, y });
                        if (cellColorAtKey === color) {
                          cellName = name;
                          break;
                        }
                      } catch (e) {
                        // Игнорируем ошибки парсинга
                      }
                    }
                    return (
                      <li key={color} className="inventory-item">
                        <span
                          className="color-dot"
                          style={{ backgroundColor: color }}
                        />
                        <span className="inventory-count">{count}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#94a3b8' }}>
                          {cellName && (
                            <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#e5e7eb', marginBottom: '2px' }}>
                              {cellName}
                            </span>
                          )}
                          <span>Сила: {cellPower}</span>
                          <span>Еда: {satietyRestore} | Строй: {buildingAmount} | Опыт: {experienceGain}</span>
                          <span>Вес: {itemWeight} (1 шт. = {singleItemWeight.toFixed(2)})</span>
                        </div>
                        <div className="inventory-item-actions">
                          <button
                            className="use-item-button use-satiety-button"
                            onClick={() => useInventoryItem(color, 'satiety')}
                            disabled={count <= 0 || (me.satiety >= me.weight)}
                            title={me.satiety >= me.weight ? 'Сытость уже полная' : `Восстановить ${satietyRestore} сытости`}
                          >
                            🍖 +{satietyRestore}
        </button>
                          <button
                            className="use-item-button use-experience-button"
                            onClick={() => useInventoryItem(color, 'experience')}
                            disabled={count <= 0}
                            title={`Получить ${experienceGain} опыта`}
                          >
                            ⭐ +{experienceGain}
                          </button>
                          <button
                            className="use-item-button"
                            onClick={() => {
                              // Сбрасываем инвентарь на клетку, где стоит игрок
                              if (!me) return;
                              const cellColorAtPlayer = getCellColor(me.position);
                              const rgb = getRGBComponents(cellColorAtPlayer);
                              const isWhite = cellColorAtPlayer === '#ffffff';
                              const isGray = rgb.r === rgb.g && rgb.g === rgb.b && cellColorAtPlayer !== '#ffffff';
                              
                              if (!isWhite && !isGray) {
                                setModalMessage({ title: 'Внимание', message: 'Встаньте на белую клетку или клетку со строительным материалом для сброса инвентаря' });
                                return;
                              }
                              
                              // Проверяем тип, если это строительный материал
                              if (isGray) {
                                const key = `${me.position.x}:${me.position.y}`;
                                const cellType = cellConstructionTypes.get(key);
                                const itemParams = cellParams.get(color);
                                const itemExperience = itemParams?.experience ?? getRGBComponents(color).b;
                                const itemType = Math.ceil(itemExperience / 10);
                                
                                if (cellType !== undefined && itemType !== cellType) {
                                  setModalMessage({ title: 'Ошибка типа', message: `Можно сбрасывать только в клетку типа ${cellType}. Тип предмета: ${itemType}` });
                                  return;
                                }
                              }
                              
                              socket?.emit('inventory:drop', {
                                color,
                                count: 1,
                              });
                            }}
                            disabled={count <= 0 || !me || (() => {
                              if (!me) return true;
                              const cellColorAtPlayer = getCellColor(me.position);
                              const rgb = getRGBComponents(cellColorAtPlayer);
                              const isWhite = cellColorAtPlayer === '#ffffff';
                              const isGray = rgb.r === rgb.g && rgb.g === rgb.b && cellColorAtPlayer !== '#ffffff';
                              return !isWhite && !isGray;
                            })()}
                            title={!me ? 'Игрок не найден' : (() => {
                              const cellColorAtPlayer = getCellColor(me.position);
                              const rgb = getRGBComponents(cellColorAtPlayer);
                              const isWhite = cellColorAtPlayer === '#ffffff';
                              const isGray = rgb.r === rgb.g && rgb.g === rgb.b && cellColorAtPlayer !== '#ffffff';
                              if (!isWhite && !isGray) {
                                return 'Встаньте на белую клетку или клетку со строительным материалом';
                              }
                              return 'Сбросить на клетку, где вы стоите';
                            })()}
                            style={{
                              backgroundColor: '#475569',
                              color: '#fff',
                              border: 'none',
                              padding: '4px 8px',
                              borderRadius: '4px',
                              cursor: (count > 0 && me && (() => {
                                const cellColorAtPlayer = getCellColor(me.position);
                                const rgb = getRGBComponents(cellColorAtPlayer);
                                const isWhite = cellColorAtPlayer === '#ffffff';
                                const isGray = rgb.r === rgb.g && rgb.g === rgb.b && cellColorAtPlayer !== '#ffffff';
                                return isWhite || isGray;
                              })()) ? 'pointer' : 'not-allowed',
                              fontSize: '11px',
                            }}
                          >
                            🏗️ Сбросить
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
                        {entry.skin ? (
                          <img
                            src={`${VITE_API_URL}/${entry.skin}`}
                            alt={entry.name}
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              objectFit: 'cover',
                              border: '2px solid rgba(148, 163, 184, 0.3)',
                            }}
                            onError={(e) => {
                              // Если изображение не загрузилось, скрываем его
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '50%',
                              backgroundColor: '#000000',
                              border: '2px solid rgba(148, 163, 184, 0.3)',
                            }}
                          />
                        )}
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
                // Получаем параметры клетки
                const params = cellParams.get(key) ?? cellParams.get(cellColor);
                const cellPower = params?.power ?? getCellPower(cellColor);
                const satietyRestore = params?.food ?? getGreenComponent(cellColor);
                const experienceGain = params?.experience ?? getRGBComponents(cellColor).b;
                const buildingAmount = params?.building ?? getRGBComponents(cellColor).r;
                // Показываем диапазон возможных значений: от 1 до ceil(building/32)
                const maxAmount = Math.max(1, Math.ceil(buildingAmount / 32));
                const collectedAmountRange = maxAmount > 1 ? `1-${maxAmount}` : '1';
                const isInCollection = me?.unlockedColors.includes(cellColor) ?? false;
                const cellName = cellNames.get(key);

  return (
    <>
                    {cellName && (
                      <div className="cell-info-item">
                        <span className="cell-info-label">Название:</span>
                        <span className="cell-info-value" style={{ fontWeight: 'bold', fontSize: '16px', color: '#e5e7eb' }}>
                          {cellName}
                        </span>
                      </div>
                    )}
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
                      <span className="cell-info-label">Параметры:</span>
                      <span className="cell-info-value">
                        Еда: {satietyRestore} | Строй: {buildingAmount} | Опыт: {experienceGain} | Сила: {cellPower}
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
                <span className="stat-label">Скин:</span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  {me.skin ? (
                    <img
                      src={`${VITE_API_URL}/${me.skin}`}
                      alt="Скин персонажа"
                      style={{
                        width: '64px',
                        height: '64px',
                        objectFit: 'cover',
                        borderRadius: '4px',
                        border: '1px solid rgba(148, 163, 184, 0.3)',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '64px',
                        height: '64px',
                        backgroundColor: 'rgba(148, 163, 184, 0.2)',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '24px',
                      }}
                    >
                      👤
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#3b82f6',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        textAlign: 'center',
                      }}
                    >
                      📤 Загрузить скин
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !socket) return;

                          // Проверяем размер файла (максимум 5MB)
                          if (file.size > 5 * 1024 * 1024) {
                            setModalMessage({ title: 'Ошибка', message: 'Размер файла не должен превышать 5MB' });
                            return;
                          }

                          // Создаем FormData
                          const formData = new FormData();
                          formData.append('file', file);

                          try {
                            const response = await fetch(`${VITE_API_URL}/players/${me.id}/skin`, {
                              method: 'POST',
                              body: formData,
                            });

                            const result = await response.json();
                            if (result.success) {
                              // Обновляем состояние игрока
                              const updatedPlayer = { ...me, skin: result.skinUrl };
                              setPlayer(updatedPlayer);
                              // Обновляем игрока в списке игроков
                              setPlayers((prev) => {
                                const updated = prev.map((p) => 
                                  p.id === me.id ? updatedPlayer : p
                                );
                                return updated;
                              });
                              // Запрашиваем обновление состояния через WebSocket
                              if (socket) {
                                socket.emit('player:restore', { playerId: me.id, userId });
                              }
                              setModalMessage({ title: 'Успех', message: 'Скин успешно загружен!' });
                            } else {
                              setModalMessage({ title: 'Ошибка', message: result.message || 'Не удалось загрузить скин' });
                            }
                          } catch (error: unknown) {
                            const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
                            setModalMessage({ title: 'Ошибка', message: `Ошибка при загрузке: ${errorMessage}` });
                          }
                        }}
                      />
                    </label>
                    {me.skin && (
                      <button
                        onClick={async () => {
                          if (!socket) return;
                          try {
                            const response = await fetch(`${VITE_API_URL}/players/${me.id}/parameter/skin`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ value: null }),
                            });
                            const result = await response.json();
                            if (result.success) {
                              const updatedPlayer = { ...me, skin: undefined };
                              setPlayer(updatedPlayer);
                              // Обновляем игрока в списке игроков
                              setPlayers((prev) => {
                                const updated = prev.map((p) => 
                                  p.id === me.id ? updatedPlayer : p
                                );
                                return updated;
                              });
                              // Запрашиваем обновление состояния через WebSocket
                              if (socket) {
                                socket.emit('player:restore', { playerId: me.id, userId });
                              }
                              setModalMessage({ title: 'Успех', message: 'Скин удален' });
                            } else {
                              setModalMessage({ title: 'Ошибка', message: result.message || 'Не удалось удалить скин' });
                            }
                          } catch (error: unknown) {
                            const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';
                            setModalMessage({ title: 'Ошибка', message: `Ошибка: ${errorMessage}` });
                          }
                        }}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#ef4444',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                        }}
                      >
                        🗑️ Удалить
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="stat-item">
                <span className="stat-label">Имя:</span>
                {isEditingName ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                      style={{
                        border: '1px solid rgba(148, 163, 184, 0.3)',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        background: 'rgba(15, 23, 42, 0.9)',
                        color: '#e5e7eb',
                        fontSize: '12px',
                        minWidth: '150px',
                      }}
                      maxLength={50}
                    />
                  </div>
                ) : (
                  <span
                    className="stat-value"
                    onClick={() => {
                      setEditingName(me.name);
                      setIsEditingName(true);
                    }}
                    style={{ cursor: 'pointer', textDecoration: 'underline' }}
                    title="Нажмите, чтобы изменить имя"
                  >
                    {me.name}
                  </span>
                )}
              </div>
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
                <span className="stat-value">{Math.round(me.satiety)}/{me.weight}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'satiety', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              {(() => {
                const foodThreshold = Math.round(me.weight * me.level);
                const totalFoodEaten = Math.round(me.totalFoodEaten ?? 0);
                const foodProgress = foodThreshold > 0 ? Math.min(100, (totalFoodEaten / foodThreshold) * 100) : 0;
                return foodThreshold > 0 ? (
                  <div className="stat-item">
                    <span className="stat-label">Набор веса:</span>
                    <div className="stat-bar">
                      <div
                        className="stat-bar-fill"
                        style={{
                          width: `${foodProgress}%`,
                          backgroundColor:
                            foodProgress >= 100
                              ? '#22c55e'
                              : foodProgress > 50
                                ? '#f59e0b'
                                : '#60a5fa',
                        }}
                      />
                    </div>
                    <span className="stat-value">{totalFoodEaten}/{foodThreshold}</span>
                    <span
                      className="help-icon"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHelpTooltip({ param: 'totalFoodEaten', x: rect.left, y: rect.top + rect.height });
                      }}
                      style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                      title="Показать описание"
                    >
                      ❓
                    </span>
                  </div>
                ) : null;
              })()}
              <div className="stat-item">
                <span className="stat-label">Опыт до след. уровня:</span>
                {(() => {
                  const requiredExp = Math.ceil(255 + 255 * me.level * 0.1);
                  const expProgress = requiredExp > 0 ? Math.min(100, (me.experience / requiredExp) * 100) : 0;
                  return (
                    <>
                      <div className="stat-bar">
                        <div
                          className="stat-bar-fill"
                          style={{
                            width: `${expProgress}%`,
                            backgroundColor:
                              expProgress >= 100
                                ? '#22c55e'
                                : expProgress > 50
                                  ? '#f59e0b'
                                  : '#60a5fa',
                          }}
                        />
                      </div>
                      <span className="stat-value">
                        {me.experience}/{requiredExp}
                      </span>
                    </>
                  );
                })()}
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'experience-to-next', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Вес:</span>
                <span className="stat-value">{me.weight}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'weight', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              {(() => {
                const defense = me.defense ?? 0;
                const minStat = Math.min(me.collectionPower, me.power, me.stamina, defense);
                const sumStats = me.collectionPower + me.power + me.stamina + defense;
                const weightIncrease = me.weight * 0.1 * (minStat / Math.max(1, sumStats));
                const foodThreshold = Math.round(me.weight * me.level);
                return foodThreshold > 0 ? (
                  <div className="stat-item">
                    <span className="stat-label">Инкремент веса:</span>
                    <span className="stat-value">{Math.ceil(weightIncrease)}</span>
                  </div>
                ) : null;
              })()}
              <div className="stat-item">
                <span className="stat-label">Выносливость:</span>
                <span className="stat-value">{me.stamina}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'stamina', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Сила сбора:</span>
                <span className="stat-value">{me.collectionPower}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'collectionPower', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Кол-во за тап:</span>
                <span className="stat-value">
                  {(() => {
                    const numerator = me.power + me.stamina;
                    const denominator = numerator + (me.defense ?? 0);
                    const multiplier = denominator > 0 ? numerator / denominator : 1;
                    return Math.max(1, Math.ceil(me.collectionPower * multiplier));
                  })()}
                </span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'collected-per-tap', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
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
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'collection-multiplier', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Макс. сила клетки:</span>
                <span className="stat-value">
                  {(() => {
                    const multiplier = (me.power / 2) + (me.stamina / 2) - (me.defense ?? 0);
                    const safeMultiplier = Math.max(0.1, multiplier);
                    // Максимальная сила клетки, которую может собрать игрок, не должна быть меньше 1
                    const maxCellPower = Math.max(1, me.collectionPower * safeMultiplier);
                    return Math.floor(maxCellPower);
                  })()}
                </span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'max-cell-power', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
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
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'move-cost', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Опыт:</span>
                <span className="stat-value">{me.experience}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'experience', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Сила:</span>
                <span className="stat-value">{me.power}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'power', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Здоровье:</span>
                <span className="stat-value">{me.health ?? 100}/{me.maxHealth ?? 100}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'health', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Макс. здоровье:</span>
                <span className="stat-value">{me.maxHealth ?? 100}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'maxHealth', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Защита:</span>
                <span className="stat-value">{me.defense ?? 0}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'defense', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Удача:</span>
                <span className="stat-value">{me.luck ?? 0}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'luck', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Регенерация:</span>
                <span className="stat-value">{me.regeneration ?? 0}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'regeneration', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Уровень:</span>
                <span className="stat-value">{me.level}</span>
                <span
                  className="help-icon"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHelpTooltip({ param: 'level', x: rect.left, y: rect.top + rect.height });
                  }}
                  style={{ cursor: 'pointer', marginLeft: '4px', color: '#60a5fa', fontSize: '12px' }}
                  title="Показать описание"
                >
                  ❓
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
                  <li>Требуется для повышения уровня: requiredExperience = начальный опыт + начальный опыт * level * 0.1 (начальный опыт = 255)</li>
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
                  <li>Повышается при накоплении опыта: requiredExperience = начальный опыт + начальный опыт * level * 0.1 (начальный опыт = 255)</li>
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
                <pre style={{ marginTop: '4px', fontSize: '11px', overflowX: 'auto' }}>{`initialExp = 255
requiredExperience = Math.ceil(initialExp + initialExp * level * 0.1)
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
      case 'buildings':
        return (
          <section className="sidebar-section">
            <h2>Постройки</h2>
            {buildings.length === 0 ? (
              <div>Загрузка построек...</div>
            ) : (
              <div>
                {buildings.map((building) => {
                  const builtCount = me?.buildings?.[building.name] ?? 0;
                  const isBuilt = builtCount > 0;
                  return (
                    <div
                      key={building.name}
                      style={{
                        marginBottom: '12px',
                        padding: '12px',
                        backgroundColor: isBuilt ? '#1e3a5f' : '#1e293b',
                        borderRadius: '4px',
                        border: isBuilt ? '2px solid #3b82f6' : '1px solid rgba(148, 163, 184, 0.3)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', color: '#fff' }}>{building.name}</h3>
                        {isBuilt && (
                          <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 'bold' }}>
                            Построено: {builtCount}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
                        <div>Сила клетки: {building.cellPower}</div>
                        <div>Жизни клетки: {building.cellHealth}</div>
                        <div>Клеток в структуре: {building.structure.length}</div>
                      </div>
                      <button
                        onClick={() => {
                          if (!socket) return;
                          socket.emit('building:build', { buildingName: building.name });
                        }}
                        style={{
                          width: '100%',
                          padding: '8px',
                          backgroundColor: isBuilt ? '#3b82f6' : '#22c55e',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: 'bold',
                        }}
                      >
                        {isBuilt ? 'Построить еще' : 'Построить'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      case 'characters':
        return (
          <section className="sidebar-section">
            <h2>Персонажи</h2>
            {me && me.weight > 255 * 2 && (
              <div style={{ marginBottom: '12px' }}>
                <button
                  onClick={() => {
                    if (!socket) return;
                    socket.emit('character:create', { userId });
                  }}
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: '#22c55e',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                  }}
                >
                  ➕ Добавить персонажа (вес уменьшится на 255)
                </button>
              </div>
            )}
            {characters.length === 0 ? (
              <div style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>
                {me && me.weight <= 255 * 2 ? (
                  <div>
                    <div>У вас пока нет персонажей.</div>
                    <div style={{ marginTop: '8px', fontSize: '11px' }}>
                      Для создания нового персонажа нужно набрать вес больше {255 * 2}
                    </div>
                  </div>
                ) : (
                  'У вас пока нет персонажей. Создайте первого!'
                )}
              </div>
            ) : (
              <div>
                {characters.map((character) => {
                  const isCurrent = character.id === me?.id;
                  return (
                    <div
                      key={character.id}
                      style={{
                        marginBottom: '12px',
                        padding: '12px',
                        backgroundColor: isCurrent ? '#1e3a5f' : '#1e293b',
                        borderRadius: '6px',
                        border: isCurrent ? '2px solid #3b82f6' : '1px solid rgba(148, 163, 184, 0.3)',
                        cursor: isCurrent ? 'default' : 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onClick={() => {
                        if (!isCurrent && socket) {
                          socket.emit('character:switch', { userId, characterId: character.id });
                        }
                      }}
                      onMouseEnter={(e) => {
                        if (!isCurrent) {
                          e.currentTarget.style.backgroundColor = '#1e3a5f';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrent) {
                          e.currentTarget.style.backgroundColor = '#1e293b';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                          {character.skin ? (
                            <img
                              src={`${VITE_API_URL}/${character.skin}`}
                              alt={character.name}
                              style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '50%',
                                objectFit: 'cover',
                                border: '2px solid rgba(148, 163, 184, 0.3)',
                                flexShrink: 0,
                              }}
                              onError={(e) => {
                                // Если изображение не загрузилось, скрываем его
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '50%',
                                backgroundColor: '#000000',
                                border: '2px solid rgba(148, 163, 184, 0.3)',
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <div>
                            <div style={{ fontSize: '16px', color: '#fff', fontWeight: 'bold', marginBottom: '4px' }}>
                              {character.name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                              Уровень: {character.level}
                            </div>
                          </div>
                        </div>
                        {isCurrent && (
                          <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 'bold' }}>
                            Текущий
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
              <div 
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  color: '#e5e7eb',
                  fontWeight: 'bold',
                  marginRight: '8px',
                }}
                title="Имя персонажа"
              >
                {me.name}
              </div>
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
                <span className="stat-icon-value">{me.experience}/{Math.ceil(255 + 255 * me.level * 0.1)}</span>
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
              <div className="stat-icon" title={`Вместительность инвентаря: ${getInventoryWeight(me.inventory, cellParams)} / ${getMaxInventoryWeight(me.weight, me.stamina)}`}>
                <span className="stat-icon-emoji">🎒</span>
                <span className="stat-icon-value" style={{
                  color: getInventoryWeight(me.inventory, cellParams) > getMaxInventoryWeight(me.weight, me.stamina) ? '#f87171' : undefined
                }}>
                  {getInventoryWeight(me.inventory, cellParams)}/{getMaxInventoryWeight(me.weight, me.stamina)}
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
            cellConstructionPoints={cellConstructionPoints}
            cellConstructionTypes={cellConstructionTypes}
            playerSatiety={me?.satiety}
            playerWeight={me?.weight}
            playerCollectionPower={me?.collectionPower}
            playerName={me?.name}
            playerSkin={me?.skin}
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
            setTapAmountCallback={(callback) => {
              tapAmountCallbackRef.current = callback;
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
              className={`tab-button ${sidebarTab === 'buildings' ? 'active' : ''}`}
              onClick={() => setSidebarTab('buildings')}
              title="Постройки"
            >
              🏗️ Постройки
            </button>
            <button
              className={`tab-button ${sidebarTab === 'help' ? 'active' : ''}`}
              onClick={() => setSidebarTab('help')}
              title="Помощь и правила"
            >
              ❓ Помощь
            </button>
            <button
              className={`tab-button ${sidebarTab === 'characters' ? 'active' : ''}`}
              onClick={() => {
                setSidebarTab('characters');
                if (socket) {
                  socket.emit('characters:list', { userId });
                }
              }}
              title="Персонажи"
            >
              👥 Персонажи
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
          className={`bar-button ${sidebarTab === 'buildings' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('buildings');
            setSidebarOpen(true);
          }}
          title="Постройки"
        >
          <span className="bar-button-icon">🏗️</span>
          <span className="bar-button-text">Постройки</span>
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
        <button
          className={`bar-button ${sidebarTab === 'characters' ? 'active' : ''}`}
          onClick={() => {
            setSidebarTab('characters');
            setSidebarOpen(true);
            if (socket) {
              socket.emit('characters:list', { userId });
            }
          }}
          title="Персонажи"
        >
          <span className="bar-button-icon">👥</span>
          <span className="bar-button-text">Персонажи</span>
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

      {/* Подсказка с описанием параметра - полноэкранное окно */}
      {helpTooltip && (() => {
        const help = getParamHelp(helpTooltip.param);
        if (!help) return null;
        return (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              zIndex: 10000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
            }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setHelpTooltip(null);
              }
            }}
          >
            <div
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.98)',
                border: '2px solid #60a5fa',
                borderRadius: '12px',
                padding: '24px',
                maxWidth: '800px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto',
                fontSize: '14px',
                color: '#e5e7eb',
                lineHeight: '1.6',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <strong style={{ color: '#60a5fa', fontSize: '20px' }}>{help.name}</strong>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setHelpTooltip(null);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '24px',
                    padding: '0',
                    lineHeight: '1',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '4px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(148, 163, 184, 0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ marginBottom: '16px', color: '#cbd5e1', fontSize: '16px' }}>{help.description}</div>
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#94a3b8', fontSize: '16px' }}>Откуда берется:</strong>
                <div style={{ marginTop: '8px', color: '#cbd5e1', fontSize: '14px' }}>{help.source}</div>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#94a3b8', fontSize: '16px' }}>Как рассчитывается:</strong>
                <div style={{ marginTop: '8px', color: '#cbd5e1', fontSize: '14px' }}>{help.calculation}</div>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: '#94a3b8', fontSize: '16px' }}>На что влияет:</strong>
                <div style={{ marginTop: '8px', color: '#cbd5e1', fontSize: '14px' }}>{help.effects}</div>
              </div>
              {help.initialValue && (
                <div style={{ marginBottom: '12px', fontSize: '14px', color: '#94a3b8' }}>
                  <strong>Начальное значение:</strong> {help.initialValue}
                </div>
              )}
              {help.upgrade && (
                <div style={{ fontSize: '14px', color: '#94a3b8' }}>
                  <strong>Улучшение:</strong> {help.upgrade}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Модальное окно для сообщений */}
      {modalMessage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
          onClick={() => setModalMessage(null)}
        >
          <div
            style={{
              backgroundColor: '#1e293b',
              border: '2px solid #3b82f6',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                borderBottom: '1px solid rgba(59, 130, 246, 0.3)',
                paddingBottom: '12px',
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: '20px',
                  color: '#3b82f6',
                  fontWeight: 'bold',
                  textShadow: '0 0 10px rgba(59, 130, 246, 0.5)',
                }}
              >
                {modalMessage?.title}
              </h2>
              <button
                onClick={() => setModalMessage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#334155';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#94a3b8';
                }}
              >
                ×
              </button>
            </div>
            <div
              style={{
                fontSize: '16px',
                color: '#e2e8f0',
                lineHeight: '1.6',
                marginBottom: '20px',
              }}
            >
              {modalMessage?.message}
            </div>
            <button
              onClick={() => setModalMessage(null)}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2563eb';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(59, 130, 246, 0.6)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#3b82f6';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)';
              }}
            >
              Понятно
            </button>
          </div>
        </div>
      )}

      {/* Модальное окно для помощи */}
      {helpTooltip && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setHelpTooltip(null)}
        >
          <div
            style={{
              backgroundColor: '#1e293b',
              border: '2px solid #3b82f6',
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '600px',
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h2 style={{ margin: 0, fontSize: '20px', color: '#3b82f6' }}>
                {helpTooltip && getParamHelp(helpTooltip.param)?.name || helpTooltip?.param}
              </h2>
              <button
                onClick={() => setHelpTooltip(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '24px',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
            {helpTooltip && (() => {
              const help = getParamHelp(helpTooltip.param);
              if (!help) return <div>Информация не найдена</div>;
              return (
                <div>
                  {help.description && (
                    <div style={{ marginBottom: '12px', fontSize: '16px', color: '#e2e8f0' }}>
                      {help.description}
                    </div>
                  )}
                  {help.source && (
                    <div style={{ marginBottom: '12px', fontSize: '14px', color: '#94a3b8' }}>
                      <strong>Источник:</strong> {help.source}
                    </div>
                  )}
                  {help.calculation && (
                    <div style={{ marginBottom: '12px', fontSize: '14px', color: '#94a3b8' }}>
                      <strong>Расчет:</strong> {help.calculation}
                    </div>
                  )}
                  {help.effects && (
                    <div style={{ marginBottom: '12px', fontSize: '14px', color: '#94a3b8' }}>
                      <strong>Влияние:</strong> {help.effects}
                    </div>
                  )}
                  {help.initialValue && (
                    <div style={{ marginBottom: '12px', fontSize: '14px', color: '#94a3b8' }}>
                      <strong>Начальное значение:</strong> {help.initialValue}
                    </div>
                  )}
                  {help.upgrade && (
                    <div style={{ fontSize: '14px', color: '#94a3b8' }}>
                      <strong>Улучшение:</strong> {help.upgrade}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
