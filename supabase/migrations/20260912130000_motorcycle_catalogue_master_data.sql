-- Master data is deliberately separated: part brand, origin, quality and motorcycle fitment.
CREATE TABLE public.countries_of_origin (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code char(2) UNIQUE NOT NULL, name text NOT NULL, name_ar text NOT NULL);
CREATE TABLE public.quality_grades (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, name text NOT NULL, name_ar text NOT NULL, sort_order int NOT NULL DEFAULT 0);
CREATE TABLE public.vehicle_makes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL, name_ar text NOT NULL);
CREATE TABLE public.vehicle_models (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make_id uuid NOT NULL REFERENCES public.vehicle_makes(id) ON DELETE CASCADE, name text NOT NULL, name_ar text, UNIQUE(make_id, name));
CREATE TABLE public.product_compatibilities (product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE, vehicle_model_id uuid NOT NULL REFERENCES public.vehicle_models(id) ON DELETE CASCADE, PRIMARY KEY(product_id, vehicle_model_id));
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS origin_id uuid REFERENCES public.countries_of_origin(id) ON DELETE SET NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS quality_grade_id uuid REFERENCES public.quality_grades(id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.countries_of_origin, public.quality_grades, public.vehicle_makes, public.vehicle_models, public.product_compatibilities TO authenticated;
ALTER TABLE public.countries_of_origin ENABLE ROW LEVEL SECURITY; ALTER TABLE public.quality_grades ENABLE ROW LEVEL SECURITY; ALTER TABLE public.vehicle_makes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY; ALTER TABLE public.product_compatibilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "origin_staff" ON public.countries_of_origin FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "quality_staff" ON public.quality_grades FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "make_staff" ON public.vehicle_makes FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "model_staff" ON public.vehicle_models FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
CREATE POLICY "fitment_staff" ON public.product_compatibilities FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));

INSERT INTO public.countries_of_origin(code,name,name_ar) VALUES ('JP','Japan','اليابان'),('CN','China','الصين'),('TH','Thailand','تايلند'),('TW','Taiwan','تايوان'),('IN','India','الهند'),('ID','Indonesia','إندونيسيا'),('KR','South Korea','كوريا الجنوبية'),('AE','United Arab Emirates','الإمارات') ON CONFLICT (code) DO NOTHING;
INSERT INTO public.quality_grades(code,name,name_ar,sort_order) VALUES ('genuine','Genuine / OEM','أصلي / وكالة',1),('premium','Premium aftermarket','بديل ممتاز',2),('standard','Standard aftermarket','تجاري درجة أولى',3),('economy','Economy','اقتصادي',4) ON CONFLICT (code) DO NOTHING;
INSERT INTO public.vehicle_makes(name,name_ar) VALUES ('Yamaha','ياماها'),('Honda','هوندا'),('Suzuki','سوزوكي'),('Kawasaki','كاواساكي'),('Bajaj','باجاج'),('TVS','تي في إس'),('Hero','هيرو'),('Haojue','هاوجوي') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.vehicle_models(make_id,name,name_ar) SELECT id,'YBR 125','واي بي آر 125' FROM public.vehicle_makes WHERE name='Yamaha' ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_models(make_id,name,name_ar) SELECT id,'FZ 150','اف زد 150' FROM public.vehicle_makes WHERE name='Yamaha' ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_models(make_id,name,name_ar) SELECT id,'CG 125','سي جي 125' FROM public.vehicle_makes WHERE name='Honda' ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_models(make_id,name,name_ar) SELECT id,'CB 125F','سي بي 125 إف' FROM public.vehicle_makes WHERE name='Honda' ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_models(make_id,name,name_ar) SELECT id,'GD 110','جي دي 110' FROM public.vehicle_makes WHERE name='Suzuki' ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_models(make_id,name,name_ar) SELECT id,'Boxer 150','بوكسر 150' FROM public.vehicle_makes WHERE name='Bajaj' ON CONFLICT DO NOTHING;
INSERT INTO public.vehicle_models(make_id,name,name_ar) SELECT id,'Star City','ستار سيتي' FROM public.vehicle_makes WHERE name='TVS' ON CONFLICT DO NOTHING;

INSERT INTO public.brands(name,name_ar) VALUES ('NGK','إن جي كيه'),('DID','دي آي دي'),('IRC','آي آر سي'),('Motul','موتول'),('Castrol','كاسترول'),('KMC','كي إم سي'),('Koso','كوسو'),('Osram','أوسرام') ON CONFLICT DO NOTHING;
INSERT INTO public.categories(name,name_ar,parent_id) VALUES ('Engine & transmission','المحرك ونقل الحركة',NULL),('Electrical & meters','الكهرباء والعدادات',NULL),('Wheels & tyres','العجلات والكفرات',NULL),('Lubricants & fluids','الزيوت والسوائل',NULL),('Body & accessories','الهيكل والزينة',NULL),('Service','الخدمات',NULL) ON CONFLICT DO NOTHING;
