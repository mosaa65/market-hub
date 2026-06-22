
CREATE POLICY "owner manage roles ins" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'owner'));
CREATE POLICY "owner manage roles upd" ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'owner')) WITH CHECK (public.has_role(auth.uid(),'owner'));
CREATE POLICY "owner manage roles del" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'owner'));

CREATE POLICY "company insert" ON public.company_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));

-- Allow owner/manager to see all profiles for user management
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY "profiles read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
