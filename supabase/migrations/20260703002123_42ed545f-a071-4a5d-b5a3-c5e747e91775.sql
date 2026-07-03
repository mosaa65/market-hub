
UPDATE categories SET name_ar = CASE name
  WHEN 'Dairy' THEN 'ألبان'
  WHEN 'Bakery' THEN 'مخبوزات'
  WHEN 'Beverages' THEN 'مشروبات'
  WHEN 'Snacks' THEN 'وجبات خفيفة'
  WHEN 'Produce' THEN 'خضروات وفواكه'
  ELSE name_ar
END WHERE name_ar IS NULL;

UPDATE units SET name_ar = CASE name
  WHEN 'Piece' THEN 'قطعة'
  WHEN 'Kilogram' THEN 'كيلوغرام'
  WHEN 'Box' THEN 'صندوق'
  WHEN 'Carton' THEN 'كرتون'
  WHEN 'Liter' THEN 'لتر'
  ELSE name_ar
END WHERE name_ar IS NULL;
