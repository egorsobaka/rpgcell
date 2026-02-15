import { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { isFeatureEnabled } from '../featureFlags';

export interface CellPosition {
  x: number;
  y: number;
}

export interface PlayerInfo {
  id: string;
  position: CellPosition;
  color: string;
  satiety?: number;
  weight?: number;
  name?: string;
}

export interface PhaserGameProps {
  playerId: string | null;
  playerPosition: CellPosition | null;
  otherPlayers: PlayerInfo[];
  getCellColor: (pos: CellPosition) => string;
  onCellClick: (pos: CellPosition, isAction?: boolean) => void;
  onPlayerClick: (playerId: string) => void;
  onMove: (dx: number, dy: number) => void;
  collectibleColors: string[];
  colorCellProgress: Map<string, { progress: number; required: number }>;
  cellHealth: Map<string, number>;
  cellConstructionPoints?: Map<string, number>;
  cellConstructionTypes?: Map<string, number>;
  playerSatiety?: number;
  playerWeight?: number;
  playerCollectionPower?: number;
  playerName?: string;
  selectedCell: CellPosition | null;
  onResourceCollected?: (position: CellPosition, amount: number) => void;
  setResourceCollectedCallback?: (callback: (position: CellPosition, amount: number) => void) => void;
  insufficientPowerMessage?: { position: CellPosition; cellPower: number; timestamp: number } | null;
  setInsufficientPowerCallback?: (callback: (position: CellPosition, cellPower: number) => void) => void;
  insufficientInventoryMessage?: { position: CellPosition; timestamp: number } | null;
  setInsufficientInventoryCallback?: (callback: (position: CellPosition) => void) => void;
  setTapAmountCallback?: (callback: (position: CellPosition, amount: number) => void) => void;
}

const TILE_SIZE = 96; // Базовый размер, будет подгоняться под экран

// Для мобильных устройств - горизонтальное поле
const isMobile = () => {
  return window.innerWidth <= 900;
};

// Общий расчет параметров сетки под размер экрана
const computeGridConfig = () => {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  // Немного уменьшаем высоту под верхний бар и нижнюю панель
  const usableWidth = screenWidth;
  const usableHeight = screenHeight - 140;

  // Минимальный размер клетки для разных устройств
  const minTileSize = isMobile() ? 48 : 64;

  // Количество клеток по ширине/высоте, стремимся заполнить всё пространство
  let tilesX = Math.max(7, Math.floor(usableWidth / minTileSize));
  let tilesY = Math.max(5, Math.floor(usableHeight / minTileSize));

  // Делаем количество клеток нечетным, чтобы игрок был строго по центру
  if (tilesX % 2 === 0) tilesX -= 1;
  if (tilesY % 2 === 0) tilesY -= 1;

  // Подбираем фактический размер клетки, чтобы сетка влезла в экран
  const tileSize = Math.floor(
    Math.min(usableWidth / tilesX, usableHeight / tilesY),
  );

  const viewRadius = {
    x: (tilesX - 1) / 2,
    y: (tilesY - 1) / 2,
  };

  return { tileSize, viewRadius };
};

const getTileSize = () => {
  const { tileSize } = computeGridConfig();
  return tileSize || TILE_SIZE;
};

const getViewRadius = () => {
  const { viewRadius } = computeGridConfig();
  return viewRadius;
};

export function PhaserGame(props: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const propsRef = useRef(props);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [orientation, setOrientation] = useState(() => 
    window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  );

  propsRef.current = props;

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    // Обработчик изменения размера окна
    const handleResize = () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      
      resizeTimeoutRef.current = setTimeout(() => {
        const newOrientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
        const orientationChanged = newOrientation !== orientation;
        
        if (orientationChanged) {
          setOrientation(newOrientation);
        }
        
        if (gameRef.current && containerRef.current) {
          const viewRadius = getViewRadius();
          const tileSize = getTileSize();
          const newWidth = tileSize * (viewRadius.x * 2 + 1);
          const newHeight = tileSize * (viewRadius.y * 2 + 1);
          
          // Если ориентация изменилась, пересоздаем игру для корректной адаптации
          if (orientationChanged) {
            gameRef.current.destroy(true);
            gameRef.current = null;
            // Игра пересоздастся в следующем рендере благодаря зависимости от orientation
            return;
          }
          
          // Обновляем размеры canvas
          const canvas = gameRef.current.canvas;
          if (canvas && (canvas.width !== newWidth || canvas.height !== newHeight)) {
            gameRef.current.scale.resize(newWidth, newHeight);
          }
        }
      }, 200);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    const sceneConfig: Phaser.Types.Scenes.SettingsConfig = {
      key: 'MainScene',
    };

    class MainScene extends Phaser.Scene {
      private graphics!: Phaser.GameObjects.Graphics;
      private renderCenterX = 0;
      private renderCenterY = 0;
      private progressTexts = new Map<
        string,
        Phaser.GameObjects.Text
      >();
      private constructionPointsTexts = new Map<
        string,
        Phaser.GameObjects.Text
      >();
      private constructionTypeTexts = new Map<
        string,
        Phaser.GameObjects.Text
      >();
      // Анимации тапов: ключ "x:y", значение - время последнего тапа
      private tapAnimations = new Map<string, number>();
      // Тексты здоровья игроков: ключ - playerId
      private playerHealthTexts = new Map<string, Phaser.GameObjects.Text>();
      // Тексты имен игроков: ключ - playerId
      private playerNameTexts = new Map<string, Phaser.GameObjects.Text>();
      // Время последней атаки на игрока: ключ - playerId, значение - timestamp
      private attackedPlayers = new Map<string, number>();
      // Анимации сбора ресурсов: ключ "x:y", значение - объект с информацией об анимации
      private resourceAnimations = new Map<string, { text: Phaser.GameObjects.Text; startTime: number; amount: number }>();
      // Всплывающие подсказки с параметрами клетки: ключ "x:y", значение - объект с текстами
      private cellInfoPopups = new Map<string, { texts: Phaser.GameObjects.Text[]; startTime: number }>();
      // Анимации недостаточной силы: ключ "x:y", значение - объект с информацией об анимации
      private insufficientPowerAnimations = new Map<string, { text: Phaser.GameObjects.Text; startTime: number; cellPower: number }>();
      // Анимации нехватки места в инвентаре: ключ "x:y", значение - объект с информацией об анимации
      private insufficientInventoryAnimations = new Map<string, { text: Phaser.GameObjects.Text; startTime: number }>();
      // Анимации тапа: ключ "x:y", значение - объект с информацией об анимации
      private tapAmountAnimations = new Map<string, { text: Phaser.GameObjects.Text; startTime: number; amount: number; initialDx: number }>();
      // Циклический массив смещений по dx
      private readonly tapDxValues = [-3, -6, -9, -12, -9, -6, -3, 0, 3, 6, 9, 12, 9, 6, 3, 0];
      private tapDxIndex = 0; // Текущий индекс в массиве смещений

      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        super(sceneConfig);
      }

      showResourceCollected(position: CellPosition, amount: number) {
        const key = `${position.x}:${position.y}`;
        
        // Удаляем старую анимацию, если есть
        const existing = this.resourceAnimations.get(key);
        if (existing) {
          existing.text.destroy();
        }
        
        const viewRadius = getViewRadius();
        const tileSize = getTileSize();
        const canvasCenterX = tileSize * (viewRadius.x + 0.5);
        const canvasCenterY = tileSize * (viewRadius.y + 0.5);
        
        // Вычисляем позицию на экране
        const dx = position.x - this.renderCenterX;
        const dy = position.y - this.renderCenterY;
        const screenX = canvasCenterX + dx * tileSize;
        const screenY = canvasCenterY + dy * tileSize;
        
        // Создаем текст с анимацией
        const fontSize = tileSize < 70 ? '20px' : '28px';
        const text = this.add.text(
          screenX,
          screenY - tileSize * 0.3,
          `+${amount}`,
          {
            fontSize,
            fontFamily: 'Arial',
            color: '#22c55e',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
          },
        );
        text.setOrigin(0.5, 0.5);
        
        // Сохраняем анимацию
        this.resourceAnimations.set(key, {
          text,
          startTime: this.time.now,
          amount,
        });
      }

      showInsufficientPower(position: CellPosition, cellPower: number) {
        const key = `${position.x}:${position.y}`;
        
        // Удаляем старую анимацию, если есть
        const existing = this.insufficientPowerAnimations.get(key);
        if (existing) {
          existing.text.destroy();
        }
        
        const viewRadius = getViewRadius();
        const tileSize = getTileSize();
        const canvasCenterX = tileSize * (viewRadius.x + 0.5);
        const canvasCenterY = tileSize * (viewRadius.y + 0.5);
        
        // Вычисляем позицию на экране
        const dx = position.x - this.renderCenterX;
        const dy = position.y - this.renderCenterY;
        const screenX = canvasCenterX + dx * tileSize;
        const screenY = canvasCenterY + dy * tileSize;
        
        // Создаем текст с анимацией
        const fontSize = tileSize < 70 ? '16px' : '20px';
        const text = this.add.text(
          screenX,
          screenY - tileSize * 0.4,
          `💪 Сила: ${cellPower}`,
          {
            fontSize,
            fontFamily: 'Arial',
            color: '#f87171',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
          },
        );
        text.setOrigin(0.5, 0.5);
        
        // Сохраняем анимацию
        this.insufficientPowerAnimations.set(key, {
          text,
          startTime: this.time.now,
          cellPower,
        });
      }

      showInsufficientInventory(position: CellPosition) {
        const key = `${position.x}:${position.y}`;
        
        // Удаляем старую анимацию, если есть
        const existing = this.insufficientInventoryAnimations.get(key);
        if (existing) {
          existing.text.destroy();
        }
        
        const viewRadius = getViewRadius();
        const tileSize = getTileSize();
        const canvasCenterX = tileSize * (viewRadius.x + 0.5);
        const canvasCenterY = tileSize * (viewRadius.y + 0.5);
        
        // Вычисляем позицию на экране
        const dx = position.x - this.renderCenterX;
        const dy = position.y - this.renderCenterY;
        const screenX = canvasCenterX + dx * tileSize;
        const screenY = canvasCenterY + dy * tileSize;
        
        // Создаем текст с анимацией
        const fontSize = tileSize < 70 ? '16px' : '20px';
        const text = this.add.text(
          screenX,
          screenY - tileSize * 0.4,
          `🎒 Нет места`,
          {
            fontSize,
            fontFamily: 'Arial',
            color: '#fbbf24',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
          },
        );
        text.setOrigin(0.5, 0.5);
        
        // Сохраняем анимацию
        this.insufficientInventoryAnimations.set(key, {
          text,
          startTime: this.time.now,
        });
      }

      showTapAmount(position: CellPosition, amount: number) {
        const key = `${position.x}:${position.y}`;
        
        // Удаляем старую анимацию, если есть
        const existing = this.tapAmountAnimations.get(key);
        if (existing) {
          existing.text.destroy();
        }
        
        const viewRadius = getViewRadius();
        const tileSize = getTileSize();
        const canvasCenterX = tileSize * (viewRadius.x + 0.5);
        const canvasCenterY = tileSize * (viewRadius.y + 0.5);
        
        // Вычисляем позицию на экране
        const dx = position.x - this.renderCenterX;
        const dy = position.y - this.renderCenterY;
        const screenX = canvasCenterX + dx * tileSize;
        const screenY = canvasCenterY + dy * tileSize;
        
        // Получаем циклическое смещение по dx из массива
        const tapDx = this.tapDxValues[this.tapDxIndex];
        // Переходим к следующему индексу (циклически)
        this.tapDxIndex = (this.tapDxIndex + 1) % this.tapDxValues.length;
        
        // Создаем текст с анимацией
        const fontSize = tileSize < 70 ? '18px' : '24px';
        const text = this.add.text(
          screenX + tapDx,
          screenY - tileSize * 0.3,
          `-${amount}`,
          {
            fontSize,
            fontFamily: 'Arial',
            color: '#ef4444',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
          },
        );
        text.setOrigin(0.5, 0.5);
        
        // Сохраняем анимацию с начальным смещением
        this.tapAmountAnimations.set(key, {
          text,
          startTime: this.time.now,
          amount,
          initialDx: tapDx,
        });
      }

      showCellInfo(position: CellPosition) {
        // Проверяем feature flag
        if (!isFeatureEnabled('SHOW_CELL_INFO_POPUPS')) {
          return;
        }
        
        const key = `${position.x}:${position.y}`;
        
        // Удаляем старую подсказку, если есть
        const existing = this.cellInfoPopups.get(key);
        if (existing) {
          existing.texts.forEach(text => text.destroy());
          this.cellInfoPopups.delete(key);
        }
        
        const { getCellColor, cellHealth, colorCellProgress } = propsRef.current;
        const cellColor = getCellColor(position);
        const health = cellHealth.get(key);
        const progress = colorCellProgress.get(key);
        
        // Если клетка белая - не показываем параметры
        if (cellColor === '#ffffff') {
          return;
        }
        
        // Вычисляем параметры клетки
        const hex = cellColor.replace('#', '');
        let r = 0;
        if (hex.length === 6) {
          r = parseInt(hex.substring(0, 2), 16);
        }
        const cellPower = Math.max(1, r + 1); // Сила клетки (красный компонент)
        
        const viewRadius = getViewRadius();
        const tileSize = getTileSize();
        const canvasCenterX = tileSize * (viewRadius.x + 0.5);
        const canvasCenterY = tileSize * (viewRadius.y + 0.5);
        
        // Вычисляем позицию на экране
        const dx = position.x - this.renderCenterX;
        const dy = position.y - this.renderCenterY;
        const screenX = canvasCenterX + dx * tileSize;
        const screenY = canvasCenterY + dy * tileSize;
        
        const fontSize = tileSize < 70 ? '14px' : '18px';
        const texts: Phaser.GameObjects.Text[] = [];
        let offsetY = -tileSize * 0.4;
        
        // Показываем силу клетки
        const powerText = this.add.text(
          screenX,
          screenY + offsetY,
          `💪 ${cellPower}`,
          {
            fontSize,
            fontFamily: 'Arial',
            color: '#60a5fa',
            stroke: '#000000',
            strokeThickness: 3,
            align: 'center',
          },
        );
        powerText.setOrigin(0.5, 0.5);
        texts.push(powerText);
        offsetY += tileSize * 0.25;
        
        // Показываем здоровье клетки, если есть
        if (health !== undefined && health > 0) {
          const healthText = this.add.text(
            screenX,
            screenY + offsetY,
            `❤️ ${health}`,
            {
              fontSize,
              fontFamily: 'Arial',
              color: '#ef4444',
              stroke: '#000000',
              strokeThickness: 3,
              align: 'center',
            },
          );
          healthText.setOrigin(0.5, 0.5);
          texts.push(healthText);
          offsetY += tileSize * 0.25;
        }
        
        // Показываем прогресс тапа, если есть
        if (progress && progress.progress > 0) {
          const progressText = this.add.text(
            screenX,
            screenY + offsetY,
            `📊 ${progress.progress}/${progress.required}`,
            {
              fontSize,
              fontFamily: 'Arial',
              color: '#fbbf24',
              stroke: '#000000',
              strokeThickness: 3,
              align: 'center',
            },
          );
          progressText.setOrigin(0.5, 0.5);
          texts.push(progressText);
        }
        
        // Сохраняем подсказку
        this.cellInfoPopups.set(key, {
          texts,
          startTime: this.time.now,
        });
      }

      create() {
        this.graphics = this.add.graphics();

        const { playerPosition, setResourceCollectedCallback } = propsRef.current;
        if (playerPosition) {
          this.renderCenterX = playerPosition.x;
          this.renderCenterY = playerPosition.y;
        }
        
        // Устанавливаем callback для показа анимации сбора ресурсов
        if (setResourceCollectedCallback) {
          setResourceCollectedCallback((position: CellPosition, amount: number) => {
            this.showResourceCollected(position, amount);
          });
        }
        
        // Устанавливаем callback для показа анимации недостаточной силы
        const { setInsufficientPowerCallback, setInsufficientInventoryCallback, setTapAmountCallback } = propsRef.current;
        if (setInsufficientPowerCallback) {
          setInsufficientPowerCallback((position: CellPosition, cellPower: number) => {
            this.showInsufficientPower(position, cellPower);
          });
        }
        // Устанавливаем callback для показа анимации нехватки места в инвентаре
        if (setInsufficientInventoryCallback) {
          setInsufficientInventoryCallback((position: CellPosition) => {
            this.showInsufficientInventory(position);
          });
        }
        // Устанавливаем callback для показа анимации тапа
        if (setTapAmountCallback) {
          setTapAmountCallback((position: CellPosition, amount: number) => {
            this.showTapAmount(position, amount);
          });
        }

        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          const { playerPosition, onCellClick, onPlayerClick, onMove, otherPlayers, getCellColor } = propsRef.current;
          if (!playerPosition) return;

          const viewRadius = getViewRadius();
          const tileSize = getTileSize();
          const canvasCenterX = tileSize * (viewRadius.x + 0.5);
          const canvasCenterY = tileSize * (viewRadius.y + 0.5);

          const dxPx = pointer.x - canvasCenterX;
          const dyPx = pointer.y - canvasCenterY;

          // Определяем позицию клика в мировых координатах
          const worldX = this.renderCenterX + dxPx / tileSize;
          const worldY = this.renderCenterY + dyPx / tileSize;
          const clickPos: CellPosition = {
            x: Math.round(worldX),
            y: Math.round(worldY),
          };

          // Определяем расстояние от игрока до клика (используем реальную позицию игрока)
          const playerCellX = Math.round(playerPosition.x);
          const playerCellY = Math.round(playerPosition.y);
          const dxTiles = clickPos.x - playerCellX;
          const dyTiles = clickPos.y - playerCellY;
          const distance = Math.max(Math.abs(dxTiles), Math.abs(dyTiles)); // Чебышевское расстояние

          // Проверяем, попал ли клик на другого игрока
          let clickedPlayer: PlayerInfo | null = null;
          for (const p of otherPlayers) {
            const dx = p.position.x - worldX;
            const dy = p.position.y - worldY;
            const dist = Math.hypot(dx, dy);
            if (dist <= 0.5) { // Радиус игрока примерно 0.5 клетки
              clickedPlayer = p;
              break;
            }
          }

          // Проверяем, есть ли игрок на этой клетке
          let playerOnCell: PlayerInfo | null = null;
          for (const p of otherPlayers) {
            if (p.position.x === clickPos.x && p.position.y === clickPos.y) {
              playerOnCell = p;
              break;
            }
          }

          // Проверяем, является ли клетка соседней (вертикально, горизонтально или по диагонали)
          const isAdjacent = distance === 1;
          // Проверяем, находится ли клетка на расстоянии 2 клеток
          const isDistance2 = distance === 2;

          // Если клик на игрока - атакуем
          if (playerOnCell || clickedPlayer) {
            const targetId = (playerOnCell || clickedPlayer)!.id;
            onPlayerClick(targetId);
            // Также показываем информацию о клетке под игроком (без действия)
            onCellClick(clickPos, false);
            // Показываем всплывающую подсказку с параметрами клетки
            this.showCellInfo(clickPos);
          } else if (isAdjacent) {
            // Клик на соседнюю клетку (включая диагональ)
            const cellColor = getCellColor(clickPos);
            const isEmpty = cellColor === '#ffffff';
            
            if (isEmpty) {
              // Если клетка пустая (белая) - передвигаем игрока
              const moveX = dxTiles > 0 ? 1 : dxTiles < 0 ? -1 : 0;
              const moveY = dyTiles > 0 ? 1 : dyTiles < 0 ? -1 : 0;
              onMove(moveX, moveY);
              // Показываем информацию о клетке
              onCellClick(clickPos, false);
            } else {
              // Если клетка не пустая - тапаем по ней
              const tapKey = `${clickPos.x}:${clickPos.y}`;
              this.tapAnimations.set(tapKey, this.time.now);
              onCellClick(clickPos, true);
              // Показываем всплывающую подсказку с параметрами клетки
              this.showCellInfo(clickPos);
            }
          } else if (isDistance2) {
            // Клик на клетку на расстоянии 2 - движение
            const moveX = dxTiles > 0 ? 1 : dxTiles < 0 ? -1 : 0;
            const moveY = dyTiles > 0 ? 1 : dyTiles < 0 ? -1 : 0;
            
            // Двигаемся в направлении клика (приоритет по большему смещению)
            const absDx = Math.abs(dxTiles);
            const absDy = Math.abs(dyTiles);
            
            if (absDx > absDy) {
              // Горизонтальное движение
              onMove(moveX, 0);
            } else if (absDy > absDx) {
              // Вертикальное движение
              onMove(0, moveY);
            } else {
              // Если равны (диагональ), выбираем по приоритету (сначала горизонталь)
              if (moveX !== 0) {
                onMove(moveX, 0);
              } else {
                onMove(0, moveY);
              }
            }
            // Показываем информацию о целевой клетке
            onCellClick(clickPos, false);
            // Показываем всплывающую подсказку с параметрами клетки
            this.showCellInfo(clickPos);
          } else {
            // Клик на дальние клетки (расстояние > 2) - движение
            const moveX = dxTiles > 0 ? 1 : dxTiles < 0 ? -1 : 0;
            const moveY = dyTiles > 0 ? 1 : dyTiles < 0 ? -1 : 0;
            
            // Двигаемся в направлении клика (приоритет по большему смещению)
            const absDx = Math.abs(dxTiles);
            const absDy = Math.abs(dyTiles);
            
            if (absDx > absDy) {
              // Горизонтальное движение
              onMove(moveX, 0);
            } else if (absDy > absDx) {
              // Вертикальное движение
              onMove(0, moveY);
            } else {
              // Если равны (диагональ), выбираем по приоритету (сначала горизонталь)
              if (moveX !== 0) {
                onMove(moveX, 0);
              } else {
                onMove(0, moveY);
              }
            }
            // Показываем информацию о целевой клетке
            onCellClick(clickPos, false);
            // Показываем всплывающую подсказку с параметрами клетки
            this.showCellInfo(clickPos);
          }
        });
      }

      override update() {
        const {
          playerPosition,
          otherPlayers,
          getCellColor,
          colorCellProgress,
          cellHealth,
          cellConstructionPoints = new Map(),
          cellConstructionTypes = new Map(),
          selectedCell,
        } = propsRef.current;
        this.graphics.clear();

        if (!playerPosition) return;

        // Плавно двигаем центр к позиции игрока
        const lerpFactor = 0.15;
        this.renderCenterX +=
          (playerPosition.x - this.renderCenterX) * lerpFactor;
        this.renderCenterY +=
          (playerPosition.y - this.renderCenterY) * lerpFactor;

        const viewRadius = getViewRadius();
        const tileSize = getTileSize();
        const canvasCenterX = tileSize * (viewRadius.x + 0.5);
        const canvasCenterY = tileSize * (viewRadius.y + 0.5);

        // Рисуем тайлы
        for (let dy = -viewRadius.y - 1; dy <= viewRadius.y + 1; dy++) {
          for (let dx = -viewRadius.x - 1; dx <= viewRadius.x + 1; dx++) {
            const worldX = Math.round(this.renderCenterX + dx);
            const worldY = Math.round(this.renderCenterY + dy);
            const color = getCellColor({ x: worldX, y: worldY });

            const offsetX = (worldX - this.renderCenterX) * tileSize;
            const offsetY = (worldY - this.renderCenterY) * tileSize;

            const screenX = canvasCenterX + offsetX - tileSize / 2;
            const screenY = canvasCenterY + offsetY - tileSize / 2;

            // Проверяем анимацию тапа
            const tapKey = `${worldX}:${worldY}`;
            const tapTime = this.tapAnimations.get(tapKey);
            const currentTime = this.time.now;
            let tapAnimationAlpha = 0;

            if (tapTime && currentTime - tapTime < 300) {
              // Анимация длится 300мс
              const elapsed = currentTime - tapTime;
              const progress = elapsed / 300;
              // Эффект пульсации: от 1.0 до 0.3 и обратно
              tapAnimationAlpha = 1 - Math.abs(progress - 0.5) * 1.4;
            } else if (tapTime) {
              // Удаляем старую анимацию
              this.tapAnimations.delete(tapKey);
            }

            // Функция для рисования волнистой клетки
            const drawWavyCell = (x: number, y: number, size: number, fillColor: number, fillAlpha: number = 1) => {
              // Рисуем простой прямоугольник без границ между клетками
              this.graphics.fillStyle(fillColor, fillAlpha);
              this.graphics.fillRect(x, y, size, size);
            };

            // Рисуем клетку без границ
            const cellColorNum = parseInt(color.replace('#', '0x'), 16);
            drawWavyCell(screenX, screenY, tileSize, cellColorNum, 1);

            // Рисуем анимацию тапа (белая подсветка с пульсацией)
            if (tapAnimationAlpha > 0) {
              drawWavyCell(screenX, screenY, tileSize, 0xffffff, tapAnimationAlpha * 0.5);
            }

            // Выделение выбранной клетки (яркая рамка)
            const isSelected = selectedCell && worldX === selectedCell.x && worldY === selectedCell.y;
            if (isSelected) {
              this.graphics.lineStyle(4, 0x00ff00, 1.0);
              const borderOffset = 2;
              this.graphics.strokeRect(
                screenX + borderOffset,
                screenY + borderOffset,
                tileSize - borderOffset * 2,
                tileSize - borderOffset * 2
              );
            }

            // Отображаем жизни клетки и прогресс игрока в виде цифр
            // НЕ показываем цифры для белых клеток
            const progressKey = `${worldX}:${worldY}`;
            const health = cellHealth.get(progressKey);
            const progress = colorCellProgress.get(progressKey);
            const constructionPoints = cellConstructionPoints?.get(progressKey);
            const constructionType = cellConstructionTypes?.get(progressKey);
            
            // Проверяем, является ли клетка серой (строительный материал)
            const rgb = parseInt(color.replace('#', ''), 16);
            const r = (rgb >> 16) & 0xff;
            const g = (rgb >> 8) & 0xff;
            const b = rgb & 0xff;
            const isGray = r === g && g === b && color !== '#ffffff';
            
            // Если клетка белая - удаляем текст и не показываем цифры
            if (color === '#ffffff') {
              const oldText = this.progressTexts.get(progressKey);
              if (oldText) {
                oldText.destroy();
                this.progressTexts.delete(progressKey);
              }
              const oldConstructionText = this.constructionPointsTexts.get(progressKey);
              if (oldConstructionText) {
                oldConstructionText.destroy();
                this.constructionPointsTexts.delete(progressKey);
              }
              const oldTypeText = this.constructionTypeTexts.get(progressKey);
              if (oldTypeText) {
                oldTypeText.destroy();
                this.constructionTypeTexts.delete(progressKey);
              }
            } else if (!health || health <= 0) {
              // Удаляем старый текст, если жизни закончились (но клетка не белая)
              const oldText = this.progressTexts.get(progressKey);
              if (oldText) {
                oldText.destroy();
                this.progressTexts.delete(progressKey);
              }
            }
            
            // Для серых клеток показываем строительные очки в верхнем правом углу
            if (isGray && constructionPoints !== undefined && constructionPoints > 0) {
              let constructionText = this.constructionPointsTexts.get(progressKey);
              const pointsString = `${constructionPoints}`;
              
              if (!constructionText) {
                const fontSize = tileSize < 70 ? '12px' : '14px';
                constructionText = this.add.text(
                  screenX + tileSize - 4,
                  screenY + 4,
                  pointsString,
                  {
                    fontSize,
                    fontFamily: 'Arial',
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 2,
                    align: 'right',
                  },
                );
                constructionText.setOrigin(1, 0); // Верхний правый угол
                this.constructionPointsTexts.set(progressKey, constructionText);
              } else {
                constructionText.setText(pointsString);
                constructionText.setPosition(screenX + tileSize - 4, screenY + 4);
              }
              
              // Показываем тип строительного материала в верхнем левом углу
              // constructionType может быть 0, поэтому проверяем !== undefined
              if (constructionType !== undefined && constructionType !== null) {
                let typeText = this.constructionTypeTexts.get(progressKey);
                const typeString = `${constructionType}`;
                
                if (!typeText) {
                  const fontSize = tileSize < 70 ? '12px' : '14px';
                  typeText = this.add.text(
                    screenX + 4,
                    screenY + 4,
                    typeString,
                    {
                      fontSize,
                      fontFamily: 'Arial',
                      color: '#ffffff',
                      stroke: '#000000',
                      strokeThickness: 2,
                      align: 'left',
                    },
                  );
                  typeText.setOrigin(0, 0); // Верхний левый угол
                  this.constructionTypeTexts.set(progressKey, typeText);
                } else {
                  typeText.setText(typeString);
                  typeText.setPosition(screenX + 4, screenY + 4);
                }
              } else {
                // Удаляем текст типа, если его нет
                const oldTypeText = this.constructionTypeTexts.get(progressKey);
                if (oldTypeText) {
                  oldTypeText.destroy();
                  this.constructionTypeTexts.delete(progressKey);
                }
              }
            } else {
              // Удаляем текст строительных очков и типа, если клетка не серая
              const oldConstructionText = this.constructionPointsTexts.get(progressKey);
              if (oldConstructionText) {
                oldConstructionText.destroy();
                this.constructionPointsTexts.delete(progressKey);
              }
              const oldTypeText = this.constructionTypeTexts.get(progressKey);
              if (oldTypeText) {
                oldTypeText.destroy();
                this.constructionTypeTexts.delete(progressKey);
              }
            }
            
            // Показываем цифры только для цветных клеток с жизнями (не серых)
            if (color !== '#ffffff' && !isGray && health && health > 0) {
              // Создаем или обновляем текстовый объект
              let progressText = this.progressTexts.get(progressKey);
              // Показываем: прогресс игрока / жизни клетки
              const playerProgress = progress?.progress ?? 0;
              const progressString = playerProgress > 0 
                ? `${playerProgress}/${health}` 
                : `${health}`;
              
              if (!progressText) {
                const fontSize = tileSize < 70 ? '14px' : '18px';
                progressText = this.add.text(
                  screenX + tileSize / 2,
                  screenY + tileSize / 2,
                  progressString,
                  {
                    fontSize,
                    fontFamily: 'Arial',
                    color: '#ffffff',
                    stroke: '#000000',
                    strokeThickness: 3,
                    align: 'center',
                  },
                );
                progressText.setOrigin(0.5, 0.5);
                this.progressTexts.set(progressKey, progressText);
              } else {
                progressText.setText(progressString);
                progressText.setPosition(screenX + tileSize / 2, screenY + tileSize / 2);
              }
            }
          }
        }

        // Игрок в центре экрана - черная окружность с глазами и лапками
        // Размер игрока пропорционален размеру клеток
        const playerRadius = tileSize / 2 - 2;
        
        // Тело игрока (черная окружность)
        this.graphics.fillStyle(0x000000, 1);
        this.graphics.fillCircle(canvasCenterX, canvasCenterY, playerRadius);

        // Глаза (белые точки) - увеличены пропорционально
        const eyeSize = Math.max(4, tileSize / 16);
        const eyeOffsetX = playerRadius * 0.3;
        const eyeOffsetY = -playerRadius * 0.2;
        this.graphics.fillStyle(0xffffff, 1);
        this.graphics.fillCircle(
          canvasCenterX - eyeOffsetX,
          canvasCenterY + eyeOffsetY,
          eyeSize,
        );
        this.graphics.fillCircle(
          canvasCenterX + eyeOffsetX,
          canvasCenterY + eyeOffsetY,
          eyeSize,
        );

        // Лапки (4 маленьких кружка снизу) - увеличены пропорционально
        const legSize = Math.max(3, tileSize / 24);
        const legOffsetY = playerRadius * 0.6;
        const legOffsetX = playerRadius * 0.4;
        this.graphics.fillStyle(0x000000, 1);
        this.graphics.fillCircle(
          canvasCenterX - legOffsetX,
          canvasCenterY + legOffsetY,
          legSize,
        );
        this.graphics.fillCircle(
          canvasCenterX - legOffsetX * 0.3,
          canvasCenterY + legOffsetY,
          legSize,
        );
        this.graphics.fillCircle(
          canvasCenterX + legOffsetX * 0.3,
          canvasCenterY + legOffsetY,
          legSize,
        );
        this.graphics.fillCircle(
          canvasCenterX + legOffsetX,
          canvasCenterY + legOffsetY,
          legSize,
        );

        // Прочие игроки - тоже черные окружности с глазами и лапками
        otherPlayers.forEach((p) => {
          const dx = p.position.x - this.renderCenterX;
          const dy = p.position.y - this.renderCenterY;
          if (Math.abs(dx) > viewRadius.x + 1 || Math.abs(dy) > viewRadius.y + 1) {
            return;
          }

          const screenX = canvasCenterX + dx * tileSize;
          const screenY = canvasCenterY + dy * tileSize;
          const otherPlayerRadius = tileSize / 2 - 4;

          // Тело игрока (черная окружность)
          this.graphics.fillStyle(0x000000, 1);
          this.graphics.fillCircle(screenX, screenY, otherPlayerRadius);

          // Глаза - увеличены пропорционально
          const eyeSize = Math.max(4, tileSize / 16);
          const eyeOffsetX = otherPlayerRadius * 0.3;
          const eyeOffsetY = -otherPlayerRadius * 0.2;
          this.graphics.fillStyle(0xffffff, 1);
          this.graphics.fillCircle(
            screenX - eyeOffsetX,
            screenY + eyeOffsetY,
            eyeSize,
          );
          this.graphics.fillCircle(
            screenX + eyeOffsetX,
            screenY + eyeOffsetY,
            eyeSize,
          );

          // Лапки - увеличены пропорционально
          const legSize = Math.max(3, tileSize / 24);
          const legOffsetY = otherPlayerRadius * 0.6;
          const legOffsetX = otherPlayerRadius * 0.4;
          this.graphics.fillStyle(0x000000, 1);
          this.graphics.fillCircle(screenX - legOffsetX, screenY + legOffsetY, legSize);
          this.graphics.fillCircle(screenX - legOffsetX * 0.3, screenY + legOffsetY, legSize);
          this.graphics.fillCircle(screenX + legOffsetX * 0.3, screenY + legOffsetY, legSize);
          this.graphics.fillCircle(screenX + legOffsetX, screenY + legOffsetY, legSize);

          // Отображаем имя игрока над ним
          const playerName = p.name || `Player-${p.id.slice(0, 4)}`;
          let nameTextObj = this.playerNameTexts.get(p.id);
          
          if (!nameTextObj) {
            const fontSize = tileSize < 70 ? '12px' : '14px';
            nameTextObj = this.add.text(
              screenX,
              screenY - otherPlayerRadius - 20,
              playerName,
              {
                fontSize,
                fontFamily: 'Arial',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 3,
                align: 'center',
              },
            );
            nameTextObj.setOrigin(0.5, 0.5);
            this.playerNameTexts.set(p.id, nameTextObj);
          } else {
            nameTextObj.setText(playerName);
            nameTextObj.setPosition(screenX, screenY - otherPlayerRadius - 20);
          }

          // Отображаем здоровье над игроком только если он был атакован недавно (в течение 3 секунд)
          const attackTime = this.attackedPlayers.get(p.id);
          const currentTime = this.time.now;
          const showHealth = attackTime !== undefined && (currentTime - attackTime) < 3000; // 3 секунды
          
          if (showHealth && p.satiety !== undefined && p.weight !== undefined) {
            const healthText = `${Math.round(p.satiety)}/${p.weight}`;
            let healthTextObj = this.playerHealthTexts.get(p.id);
            
            if (!healthTextObj) {
              const fontSize = tileSize < 70 ? '12px' : '14px';
              healthTextObj = this.add.text(
                screenX,
                screenY - otherPlayerRadius - 40,
                healthText,
                {
                  fontSize,
                  fontFamily: 'Arial',
                  color: '#22c55e',
                  stroke: '#000000',
                  strokeThickness: 3,
                  align: 'center',
                },
              );
              healthTextObj.setOrigin(0.5, 0.5);
              this.playerHealthTexts.set(p.id, healthTextObj);
            } else {
              healthTextObj.setText(healthText);
              healthTextObj.setPosition(screenX, screenY - otherPlayerRadius - 40);
              healthTextObj.setVisible(true);
            }
          } else {
            // Скрываем здоровье, если прошло больше 3 секунд
            const healthTextObj = this.playerHealthTexts.get(p.id);
            if (healthTextObj) {
              healthTextObj.setVisible(false);
            }
          }
        });

        // Удаляем тексты здоровья и имен для игроков, которых больше нет на экране
        const visiblePlayerIds = new Set(otherPlayers.map(p => p.id));
        for (const [playerId, textObj] of this.playerHealthTexts.entries()) {
          if (!visiblePlayerIds.has(playerId)) {
            textObj.destroy();
            this.playerHealthTexts.delete(playerId);
          }
        }
        for (const [playerId, textObj] of this.playerNameTexts.entries()) {
          if (!visiblePlayerIds.has(playerId)) {
            textObj.destroy();
            this.playerNameTexts.delete(playerId);
          }
        }

        // Отображаем имя главного игрока
        const { playerName, playerSatiety, playerWeight } = propsRef.current;
        if (playerPosition && playerName) {
          let nameTextObj = this.playerNameTexts.get('main');
          
          if (!nameTextObj) {
            const fontSize = tileSize < 70 ? '12px' : '14px';
            nameTextObj = this.add.text(
              canvasCenterX,
              canvasCenterY - playerRadius - 20,
              playerName,
              {
                fontSize,
                fontFamily: 'Arial',
                color: '#ffffff',
                stroke: '#000000',
                strokeThickness: 3,
                align: 'center',
              },
            );
            nameTextObj.setOrigin(0.5, 0.5);
            this.playerNameTexts.set('main', nameTextObj);
          } else {
            nameTextObj.setText(playerName);
            nameTextObj.setPosition(canvasCenterX, canvasCenterY - playerRadius - 20);
          }
        }

        // Отображаем здоровье над главным игроком только если он был атакован недавно
        const mainAttackTime = this.attackedPlayers.get('main');
        const mainHealthCheckTime = this.time.now;
        const showMainHealth = mainAttackTime !== undefined && (mainHealthCheckTime - mainAttackTime) < 3000;
        
        if (showMainHealth && playerPosition && playerSatiety !== undefined && playerWeight !== undefined) {
          const healthText = `${Math.round(playerSatiety)}/${playerWeight}`;
          let healthTextObj = this.playerHealthTexts.get('main');
          
          if (!healthTextObj) {
            const fontSize = tileSize < 70 ? '12px' : '14px';
            healthTextObj = this.add.text(
              canvasCenterX,
              canvasCenterY - playerRadius - 40,
              healthText,
              {
                fontSize,
                fontFamily: 'Arial',
                color: '#22c55e',
                stroke: '#000000',
                strokeThickness: 3,
                align: 'center',
              },
            );
            healthTextObj.setOrigin(0.5, 0.5);
            this.playerHealthTexts.set('main', healthTextObj);
          } else {
            healthTextObj.setText(healthText);
            healthTextObj.setPosition(canvasCenterX, canvasCenterY - playerRadius - 40);
            healthTextObj.setVisible(true);
          }
        } else {
          // Скрываем здоровье главного игрока, если прошло больше 3 секунд
          const healthTextObj = this.playerHealthTexts.get('main');
          if (healthTextObj) {
            healthTextObj.setVisible(false);
          }
        }
        
        // Обновляем анимации сбора ресурсов
        const currentTime = this.time.now;
        const animationDuration = 1500; // 1.5 секунды
        for (const [key, anim] of this.resourceAnimations.entries()) {
          const elapsed = currentTime - anim.startTime;
          if (elapsed >= animationDuration) {
            // Анимация завершена - удаляем
            anim.text.destroy();
            this.resourceAnimations.delete(key);
          } else {
            // Обновляем позицию и прозрачность
            const viewRadius = getViewRadius();
            const tileSize = getTileSize();
            const canvasCenterX = tileSize * (viewRadius.x + 0.5);
            const canvasCenterY = tileSize * (viewRadius.y + 0.5);
            
            const [x, y] = key.split(':').map(Number);
            const dx = x - this.renderCenterX;
            const dy = y - this.renderCenterY;
            const screenX = canvasCenterX + dx * tileSize;
            const screenY = canvasCenterY + dy * tileSize;
            
            // Движение вверх и затухание
            const progress = elapsed / animationDuration;
            const offsetY = -tileSize * 0.3 - progress * tileSize * 0.5;
            const alpha = 1 - progress;
            
            anim.text.setPosition(screenX, screenY + offsetY);
            anim.text.setAlpha(alpha);
          }
        }
        
        // Обновляем анимации недостаточной силы
        const insufficientPowerDuration = 3000; // 3 секунды
        for (const [key, anim] of this.insufficientPowerAnimations.entries()) {
          const elapsed = currentTime - anim.startTime;
          if (elapsed >= insufficientPowerDuration) {
            // Анимация завершена - удаляем
            anim.text.destroy();
            this.insufficientPowerAnimations.delete(key);
          } else {
            // Обновляем позицию и прозрачность
            const viewRadius = getViewRadius();
            const tileSize = getTileSize();
            const canvasCenterX = tileSize * (viewRadius.x + 0.5);
            const canvasCenterY = tileSize * (viewRadius.y + 0.5);
            
            const [x, y] = key.split(':').map(Number);
            const dx = x - this.renderCenterX;
            const dy = y - this.renderCenterY;
            const screenX = canvasCenterX + dx * tileSize;
            const screenY = canvasCenterY + dy * tileSize;
            
            // Движение вверх и затухание
            const progress = elapsed / insufficientPowerDuration;
            const offsetY = -tileSize * 0.4 - progress * tileSize * 0.3;
            const alpha = 1 - progress;
            
            anim.text.setPosition(screenX, screenY + offsetY);
            anim.text.setAlpha(alpha);
          }
        }

        // Обновляем анимации нехватки места в инвентаре
        const insufficientInventoryDuration = 3000; // 3 секунды
        for (const [key, anim] of this.insufficientInventoryAnimations.entries()) {
          const elapsed = currentTime - anim.startTime;
          if (elapsed >= insufficientInventoryDuration) {
            // Анимация завершена - удаляем
            anim.text.destroy();
            this.insufficientInventoryAnimations.delete(key);
          } else {
            // Обновляем позицию и прозрачность
            const viewRadius = getViewRadius();
            const tileSize = getTileSize();
            const canvasCenterX = tileSize * (viewRadius.x + 0.5);
            const canvasCenterY = tileSize * (viewRadius.y + 0.5);
            
            const [x, y] = key.split(':').map(Number);
            const dx = x - this.renderCenterX;
            const dy = y - this.renderCenterY;
            const screenX = canvasCenterX + dx * tileSize;
            const screenY = canvasCenterY + dy * tileSize;
            
            // Движение вверх и затухание
            const progress = elapsed / insufficientInventoryDuration;
            const offsetY = -tileSize * 0.4 - progress * tileSize * 0.3;
            const alpha = 1 - progress;
            
            anim.text.setPosition(screenX, screenY + offsetY);
            anim.text.setAlpha(alpha);
          }
        }

        // Обновляем анимации тапа
        const tapAmountDuration = 1000; // 1 секунда
        for (const [key, anim] of this.tapAmountAnimations.entries()) {
          const elapsed = currentTime - anim.startTime;
          if (elapsed >= tapAmountDuration) {
            // Анимация завершена - удаляем
            anim.text.destroy();
            this.tapAmountAnimations.delete(key);
          } else {
            // Обновляем позицию и прозрачность
            const viewRadius = getViewRadius();
            const tileSize = getTileSize();
            const canvasCenterX = tileSize * (viewRadius.x + 0.5);
            const canvasCenterY = tileSize * (viewRadius.y + 0.5);
            
            const [x, y] = key.split(':').map(Number);
            const dx = x - this.renderCenterX;
            const dy = y - this.renderCenterY;
            const screenX = canvasCenterX + dx * tileSize;
            const screenY = canvasCenterY + dy * tileSize;
            
            // Движение вверх и затухание с учетом начального смещения по dx
            const progress = elapsed / tapAmountDuration;
            const offsetY = -tileSize * 0.3 - progress * tileSize * 0.4;
            const alpha = 1 - progress;
            
            // Применяем начальное смещение по dx
            anim.text.setPosition(screenX + anim.initialDx, screenY + offsetY);
            anim.text.setAlpha(alpha);
          }
        }
        
        // Обновляем всплывающие подсказки с параметрами клетки (только если feature flag включен)
        if (isFeatureEnabled('SHOW_CELL_INFO_POPUPS')) {
          const popupDuration = 2000; // 2 секунды
          for (const [key, popup] of this.cellInfoPopups.entries()) {
            const elapsed = currentTime - popup.startTime;
            if (elapsed >= popupDuration) {
              // Подсказка завершена - удаляем
              popup.texts.forEach(text => text.destroy());
              this.cellInfoPopups.delete(key);
            } else {
              // Обновляем позицию и прозрачность
              const viewRadius = getViewRadius();
              const tileSize = getTileSize();
              const canvasCenterX = tileSize * (viewRadius.x + 0.5);
              const canvasCenterY = tileSize * (viewRadius.y + 0.5);
              
              const [x, y] = key.split(':').map(Number);
              const dx = x - this.renderCenterX;
              const dy = y - this.renderCenterY;
              const screenX = canvasCenterX + dx * tileSize;
              const screenY = canvasCenterY + dy * tileSize;
              
              // Движение вверх и затухание
              const progress = elapsed / popupDuration;
              const baseOffsetY = -tileSize * 0.4;
              const moveUp = progress * tileSize * 0.3;
              const alpha = 1 - progress;
              
              let currentOffsetY = baseOffsetY;
              popup.texts.forEach((text) => {
                text.setPosition(screenX, screenY + currentOffsetY + moveUp);
                text.setAlpha(alpha);
                currentOffsetY += tileSize * 0.25;
              });
            }
          }
        }
      }
    }

    const viewRadius = getViewRadius();
    const tileSize = getTileSize();
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: tileSize * (viewRadius.x * 2 + 1),
      height: tileSize * (viewRadius.y * 2 + 1),
      parent: containerRef.current,
      backgroundColor: '#000000',
      scene: MainScene,
      physics: {
        default: 'arcade',
      },
    };

    gameRef.current = new Phaser.Game(config);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [orientation]);

  return (
    <div
      ref={containerRef}
      style={{
        border: '1px solid #444',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    />
  );
}

