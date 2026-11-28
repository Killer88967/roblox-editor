/** Roblox enum values the GUI renderer needs (stable across Roblox versions). */

export const TextXAlignment = { Left: 0, Right: 1, Center: 2 } as const;
export const TextYAlignment = { Top: 0, Center: 1, Bottom: 2 } as const;
export const FillDirection = { Horizontal: 0, Vertical: 1 } as const;
export const HorizontalAlignment = { Center: 0, Left: 1, Right: 2 } as const;
export const VerticalAlignment = { Center: 0, Top: 1, Bottom: 2 } as const;
export const SortOrder = { Name: 0, Custom: 1, LayoutOrder: 2 } as const;
export const SizeConstraint = { RelativeXY: 0, RelativeXX: 1, RelativeYY: 2 } as const;
export const AutomaticSize = { None: 0, X: 1, Y: 2, XY: 3 } as const;
export const ScaleType = { Stretch: 0, Slice: 1, Tile: 2, Fit: 3, Crop: 4 } as const;
export const AspectType = { FitWithinMaxSize: 0, ScaleWithParentSize: 1 } as const;
export const DominantAxis = { Width: 0, Height: 1 } as const;
export const ApplyStrokeMode = { Contextual: 0, Border: 1 } as const;
export const BorderMode = { Outline: 0, Middle: 1, Inset: 2 } as const;
export const TextTruncate = { None: 0, AtEnd: 1, SplitWord: 2 } as const;
export const StartCorner = { TopLeft: 0, TopRight: 1, BottomLeft: 2, BottomRight: 3 } as const;

/** Classes drawn as GUI objects (everything else under a ScreenGui is a modifier or ignored). */
export const GUI_OBJECTS = new Set([
  "Frame",
  "TextLabel",
  "TextButton",
  "TextBox",
  "ImageLabel",
  "ImageButton",
  "ScrollingFrame",
  "CanvasGroup",
  "ViewportFrame",
  "VideoFrame",
]);

export const TEXT_OBJECTS = new Set(["TextLabel", "TextButton", "TextBox"]);
export const IMAGE_OBJECTS = new Set(["ImageLabel", "ImageButton"]);

/** Height of Roblox's top bar, which ScreenGuis sit below unless IgnoreGuiInset is on. */
export const GUI_INSET = 58;
