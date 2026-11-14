// Raw material categories. Keep in step with the materials_category_chk constraint in SQL file 06.
export const MATERIAL_CATEGORIES = [
  { id: 'oil', label: 'Oils', one: 'Oil', unit: 'ml', fixedUnit: true, use: 'Used in maceration' },
  { id: 'solvent', label: 'Solvent', one: 'Solvent', unit: 'ml', fixedUnit: true, use: 'Used in maceration' },
  { id: 'bottle', label: 'Bottles', one: 'Bottle', unit: 'pcs', use: 'Used in bottling' },
  { id: 'bottle_sticker', label: 'Bottle stickers', one: 'Bottle sticker', unit: 'pcs', use: 'Used in bottling' },
  { id: 'box', label: 'Boxes', one: 'Box', unit: 'pcs', use: 'Used in packaging (box set)' },
  { id: 'box_sticker', label: 'Box stickers', one: 'Box sticker', unit: 'pcs', use: 'Used in packaging (box set)' },
  { id: 'pouch', label: 'Pouches', one: 'Pouch', unit: 'pcs', use: 'Used in packaging (pouch set)' },
  { id: 'pouch_sticker', label: 'Pouch stickers', one: 'Pouch sticker', unit: 'pcs', use: 'Used in packaging (pouch set)' },
  { id: 'wrap', label: 'Wrap', one: 'Wrap', unit: 'pcs', use: 'Used in packaging' },
  { id: 'other', label: 'Other materials', one: 'Other material', unit: 'pcs', use: 'Tracked in stock; not used in a production step yet' },
];

export const CAT_LABEL = Object.fromEntries(MATERIAL_CATEGORIES.map((c) => [c.id, c.label]));
export const CAT_ONE = Object.fromEntries(MATERIAL_CATEGORIES.map((c) => [c.id, c.one]));