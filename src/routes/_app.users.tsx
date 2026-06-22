import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ShieldCheck, Trash2 } from "lucide-react";

const ROLES = ["owner", "manager", "accountant", "cashier", "warehouse"] as const;

export const Route = createFileRoute("/_app/users")({
  head: () => ({ meta: [{ title: "Users & Roles — Vortex ERP" }] }),
  component: UsersPage,
});

function UsersPage() {
  const { t, lang } = useI18n();
  const { hasRole, user } = useAuth();
  const isOwner = hasRole("owner");
  const [rows, setRows] = useState<any[]>([]);
  const [adding, setAdding] = useState<{ user_id: string; role: string } | null>(null);

  async function load() {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, avatar_url, created_at"),
      supabase.from("user_roles").select("id, user_id, role"),
    ]);
    const byUser = new Map<string, any[]>();
    (roles ?? []).forEach((r) => {
      const arr = byUser.get(r.user_id) ?? []; arr.push(r); byUser.set(r.user_id, arr);
    });
    setRows((profiles ?? []).map((p) => ({ ...p, roles: byUser.get(p.id) ?? [] })));
  }
  useEffect(() => { load(); }, []);

  async function assignRole(userId: string, role: string) {
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: role as any });
    if (error) return toast.error(error.message);
    toast.success(lang === "ar" ? "تم منح الصلاحية" : "Role granted");
    load();
  }

  async function removeRole(id: string) {
    if (!confirm(lang === "ar" ? "إزالة الصلاحية؟" : "Remove role?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  return (
    <>
      <PageHeader
        title={t("users.title")}
        subtitle={lang === "ar" ? "إدارة المستخدمين وصلاحياتهم" : "Manage users and their roles"}
      />
      {!isOwner && (
        <div className="mb-4 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-sm text-amber-500">
          {lang === "ar" ? "صلاحية المالك فقط يمكنها تعديل الأدوار" : "Only the owner can change roles"}
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{lang === "ar" ? "الاسم" : "Name"}</TableHead>
              <TableHead>{lang === "ar" ? "الأدوار" : "Roles"}</TableHead>
              <TableHead>{lang === "ar" ? "انضم" : "Joined"}</TableHead>
              {isOwner && <TableHead className="text-end">{lang === "ar" ? "إجراءات" : "Actions"}</TableHead>}
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">{lang === "ar" ? "لا يوجد مستخدمون" : "No users"}</TableCell></TableRow>
                : rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-primary/10 grid place-items-center text-xs font-medium">{(r.full_name ?? "?").slice(0,2).toUpperCase()}</div>
                        <span>{r.full_name ?? "—"} {r.id === user?.id && <span className="text-xs text-muted-foreground">({lang === "ar" ? "أنت" : "you"})</span>}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {r.roles.length === 0 ? <span className="text-xs text-muted-foreground">{lang === "ar" ? "بلا دور" : "no role"}</span>
                          : r.roles.map((ro: any) => (
                            <Badge key={ro.id} variant={ro.role === "owner" ? "default" : "secondary"} className="gap-1">
                              <ShieldCheck className="h-3 w-3" />{ro.role}
                              {isOwner && r.id !== user?.id && (
                                <button onClick={() => removeRole(ro.id)} className="ms-1 opacity-60 hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
                              )}
                            </Badge>
                          ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</TableCell>
                    {isOwner && (
                      <TableCell className="text-end">
                        <Select onValueChange={(v) => assignRole(r.id, v)}>
                          <SelectTrigger className="w-36 h-8 ms-auto"><SelectValue placeholder={lang === "ar" ? "إضافة دور" : "Add role"} /></SelectTrigger>
                          <SelectContent>
                            {ROLES.filter((ro) => !r.roles.find((x: any) => x.role === ro)).map((ro) => <SelectItem key={ro} value={ro}>{ro}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        {lang === "ar" ? "لإضافة مستخدم جديد: اطلب منه التسجيل من صفحة /auth، وسيظهر هنا لتعيين دوره." : "To add a new user: have them sign up at /auth, then assign their role here."}
      </p>
    </>
  );
}
