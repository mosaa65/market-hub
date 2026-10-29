export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string;
          id: string;
          payload: Json | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type: string;
          id?: string;
          payload?: Json | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string;
          id?: string;
          payload?: Json | null;
        };
        Relationships: [];
      };
      brands: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          name_ar: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          name_ar?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          name_ar?: string | null;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          name_ar: string | null;
          parent_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          name_ar?: string | null;
          parent_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          name_ar?: string | null;
          parent_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      company_settings: {
        Row: {
          address: string | null;
          barcode_enabled: boolean;
          currency: string;
          currency_symbol: string;
          email: string | null;
          id: number;
          invoice_prefix: string;
          invoice_number_digits: number;
          invoice_number_period: string;
          legal_name: string | null;
          logo_url: string | null;
          name: string;
          phone: string | null;
          purchase_invoice_prefix: string;
          tax_number: string | null;
          tax_rate: number;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          barcode_enabled?: boolean;
          currency?: string;
          currency_symbol?: string;
          email?: string | null;
          id?: number;
          invoice_prefix?: string;
          invoice_number_digits?: number;
          invoice_number_period?: string;
          legal_name?: string | null;
          logo_url?: string | null;
          name?: string;
          phone?: string | null;
          purchase_invoice_prefix?: string;
          tax_number?: string | null;
          tax_rate?: number;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          barcode_enabled?: boolean;
          currency?: string;
          currency_symbol?: string;
          email?: string | null;
          id?: number;
          invoice_prefix?: string;
          invoice_number_digits?: number;
          invoice_number_period?: string;
          legal_name?: string | null;
          logo_url?: string | null;
          name?: string;
          phone?: string | null;
          purchase_invoice_prefix?: string;
          tax_number?: string | null;
          tax_rate?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      customer_payment_splits: {
        Row: {
          amount: number;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          id: string;
          invoice_id: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          occurred_at: string;
          payment_id: string | null;
        };
        Insert: {
          amount: number;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          invoice_id?: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          occurred_at?: string;
          payment_id?: string | null;
        };
        Update: {
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          invoice_id?: string | null;
          method?: Database["public"]["Enums"]["payment_method"];
          occurred_at?: string;
          payment_id?: string | null;
        };
        Relationships: [];
      };
      customer_payments: {
        Row: {
          amount: number;
          created_at: string;
          created_by: string | null;
          customer_id: string;
          id: string;
          invoice_id: string | null;
          note: string | null;
          payment_date: string;
          payment_method: Database["public"]["Enums"]["payment_method"];
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          created_by?: string | null;
          customer_id: string;
          id?: string;
          invoice_id?: string | null;
          note?: string | null;
          payment_date?: string;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string;
          id?: string;
          invoice_id?: string | null;
          note?: string | null;
          payment_date?: string;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_payments_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_payments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "sales_invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          address: string | null;
          balance: number;
          created_at: string;
          credit_limit: number;
          email: string | null;
          id: string;
          is_active: boolean;
          is_system: boolean;
          loyalty_points: number;
          name: string;
          phone: string | null;
          system_key: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          balance?: number;
          created_at?: string;
          credit_limit?: number;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          loyalty_points?: number;
          name: string;
          phone?: string | null;
          system_key?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          balance?: number;
          created_at?: string;
          credit_limit?: number;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          loyalty_points?: number;
          name?: string;
          phone?: string | null;
          system_key?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      expense_categories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          name_ar: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          name_ar?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          name_ar?: string | null;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          amount: number;
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          expense_date: string;
          id: string;
          note: string | null;
          payment_method: Database["public"]["Enums"]["payment_method"];
          updated_at: string;
        };
        Insert: {
          amount: number;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          expense_date?: string;
          id?: string;
          note?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          expense_date?: string;
          id?: string;
          note?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory: {
        Row: {
          id: string;
          product_id: string;
          quantity: number;
          updated_at: string;
          warehouse_id: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          quantity?: number;
          updated_at?: string;
          warehouse_id: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          quantity?: number;
          updated_at?: string;
          warehouse_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      loyalty_transactions: {
        Row: {
          created_at: string;
          created_by: string | null;
          customer_id: string;
          id: string;
          kind: string;
          note: string | null;
          points: number;
          reference_id: string | null;
          reference_type: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          customer_id: string;
          id?: string;
          kind: string;
          note?: string | null;
          points: number;
          reference_id?: string | null;
          reference_type?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          customer_id?: string;
          id?: string;
          kind?: string;
          note?: string | null;
          points?: number;
          reference_id?: string | null;
          reference_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      product_batches: {
        Row: {
          batch_number: string;
          created_at: string;
          created_by: string | null;
          expiry_date: string | null;
          id: string;
          note: string | null;
          product_id: string;
          quantity: number;
          unit_cost: number;
          updated_at: string;
          warehouse_id: string;
        };
        Insert: {
          batch_number: string;
          created_at?: string;
          created_by?: string | null;
          expiry_date?: string | null;
          id?: string;
          note?: string | null;
          product_id: string;
          quantity?: number;
          unit_cost?: number;
          updated_at?: string;
          warehouse_id: string;
        };
        Update: {
          batch_number?: string;
          created_at?: string;
          created_by?: string | null;
          expiry_date?: string | null;
          id?: string;
          note?: string | null;
          product_id?: string;
          quantity?: number;
          unit_cost?: number;
          updated_at?: string;
          warehouse_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_batches_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_batches_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      product_uom_barcodes: {
        Row: {
          barcode: string;
          company_id: number;
          created_at: string;
          id: string;
          is_active: boolean;
          is_primary: boolean;
          product_id: string;
          product_uom_id: string;
        };
        Insert: {
          barcode: string;
          company_id?: number;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          product_id: string;
          product_uom_id: string;
        };
        Update: {
          barcode?: string;
          company_id?: number;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          product_id?: string;
          product_uom_id?: string;
        };
        Relationships: [];
      };
      product_uom_prices: {
        Row: {
          company_id: number;
          id: string;
          product_id: string;
          product_uom_id: string;
          purchase_price: number | null;
          sale_price: number | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          company_id?: number;
          id?: string;
          product_id: string;
          product_uom_id: string;
          purchase_price?: number | null;
          sale_price?: number | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          company_id?: number;
          id?: string;
          product_id?: string;
          product_uom_id?: string;
          purchase_price?: number | null;
          sale_price?: number | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      product_uoms: {
        Row: {
          can_purchase: boolean;
          can_sell: boolean;
          conversion_basis: string;
          conversion_note: string | null;
          created_at: string;
          factor_to_base: number;
          id: string;
          is_active: boolean;
          is_base: boolean;
          is_default_purchase: boolean;
          is_default_sale: boolean;
          product_id: string;
          quantity_increment: number;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          can_purchase?: boolean;
          can_sell?: boolean;
          conversion_basis?: string;
          conversion_note?: string | null;
          created_at?: string;
          factor_to_base: number;
          id?: string;
          is_active?: boolean;
          is_base?: boolean;
          is_default_purchase?: boolean;
          is_default_sale?: boolean;
          product_id: string;
          quantity_increment?: number;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          can_purchase?: boolean;
          can_sell?: boolean;
          conversion_basis?: string;
          conversion_note?: string | null;
          created_at?: string;
          factor_to_base?: number;
          id?: string;
          is_active?: boolean;
          is_base?: boolean;
          is_default_purchase?: boolean;
          is_default_sale?: boolean;
          product_id?: string;
          quantity_increment?: number;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          barcode: string | null;
          brand_id: string | null;
          category_id: string | null;
          cost_price: number;
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          is_active: boolean;
          min_stock: number;
          name: string;
          name_ar: string | null;
          package_weight_kg: number | null;
          sale_price: number;
          sku: string | null;
          tax_rate: number;
          track_expiry: boolean;
          unit_id: string | null;
          updated_at: string;
        };
        Insert: {
          barcode?: string | null;
          brand_id?: string | null;
          category_id?: string | null;
          cost_price?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          min_stock?: number;
          name: string;
          name_ar?: string | null;
          package_weight_kg?: number | null;
          sale_price?: number;
          sku?: string | null;
          tax_rate?: number;
          track_expiry?: boolean;
          unit_id?: string | null;
          updated_at?: string;
        };
        Update: {
          barcode?: string | null;
          brand_id?: string | null;
          category_id?: string | null;
          cost_price?: number;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          min_stock?: number;
          name?: string;
          name_ar?: string | null;
          package_weight_kg?: number | null;
          sale_price?: number;
          sku?: string | null;
          tax_rate?: number;
          track_expiry?: boolean;
          unit_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey";
            columns: ["brand_id"];
            isOneToOne: false;
            referencedRelation: "brands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          language: string;
          phone: string | null;
          theme: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          language?: string;
          phone?: string | null;
          theme?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          language?: string;
          phone?: string | null;
          theme?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      purchase_invoice_items: {
        Row: {
          base_unit_cost: number | null;
          base_quantity: number | null;
          discount: number;
          entered_quantity: number | null;
          entered_unit_cost: number | null;
          id: string;
          invoice_id: string;
          product_id: string;
          quantity: number;
          tax: number;
          total: number;
          unit_cost: number;
          uom_conversion_factor: number | null;
          uom_id: string | null;
          uom_quantity_increment: number | null;
        };
        Insert: {
          base_unit_cost?: number | null;
          base_quantity?: number | null;
          discount?: number;
          entered_quantity?: number | null;
          entered_unit_cost?: number | null;
          id?: string;
          invoice_id: string;
          product_id: string;
          quantity: number;
          tax?: number;
          total: number;
          unit_cost: number;
          uom_conversion_factor?: number | null;
          uom_id?: string | null;
          uom_quantity_increment?: number | null;
        };
        Update: {
          base_unit_cost?: number | null;
          base_quantity?: number | null;
          discount?: number;
          entered_quantity?: number | null;
          entered_unit_cost?: number | null;
          id?: string;
          invoice_id?: string;
          product_id?: string;
          quantity?: number;
          tax?: number;
          total?: number;
          unit_cost?: number;
          uom_conversion_factor?: number | null;
          uom_id?: string | null;
          uom_quantity_increment?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "purchase_invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_invoice_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_invoices: {
        Row: {
          created_at: string;
          created_by: string | null;
          discount: number;
          id: string;
          invoice_number: string;
          note: string | null;
          paid: number;
          payment_method: Database["public"]["Enums"]["payment_method"] | null;
          status: Database["public"]["Enums"]["invoice_status"];
          subtotal: number;
          supplier_id: string | null;
          tax: number;
          total: number;
          updated_at: string;
          warehouse_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          discount?: number;
          id?: string;
          invoice_number: string;
          note?: string | null;
          paid?: number;
          payment_method?: Database["public"]["Enums"]["payment_method"] | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          subtotal?: number;
          supplier_id?: string | null;
          tax?: number;
          total?: number;
          updated_at?: string;
          warehouse_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          discount?: number;
          id?: string;
          invoice_number?: string;
          note?: string | null;
          paid?: number;
          payment_method?: Database["public"]["Enums"]["payment_method"] | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          subtotal?: number;
          supplier_id?: string | null;
          tax?: number;
          total?: number;
          updated_at?: string;
          warehouse_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_invoices_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_return_items: {
        Row: {
          base_quantity: number | null;
          entered_quantity: number | null;
          entered_unit_cost: number | null;
          id: string;
          invoice_item_id: string | null;
          product_id: string;
          quantity: number;
          return_id: string;
          tax: number;
          total: number;
          unit_cost: number;
          uom_conversion_factor: number | null;
          uom_id: string | null;
          uom_quantity_increment: number | null;
        };
        Insert: {
          base_quantity?: number | null;
          entered_quantity?: number | null;
          entered_unit_cost?: number | null;
          id?: string;
          invoice_item_id?: string | null;
          product_id: string;
          quantity: number;
          return_id: string;
          tax?: number;
          total?: number;
          unit_cost: number;
          uom_conversion_factor?: number | null;
          uom_id?: string | null;
          uom_quantity_increment?: number | null;
        };
        Update: {
          base_quantity?: number | null;
          entered_quantity?: number | null;
          entered_unit_cost?: number | null;
          id?: string;
          invoice_item_id?: string | null;
          product_id?: string;
          quantity?: number;
          return_id?: string;
          tax?: number;
          total?: number;
          unit_cost?: number;
          uom_conversion_factor?: number | null;
          uom_id?: string | null;
          uom_quantity_increment?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_return_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_return_items_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: false;
            referencedRelation: "purchase_returns";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_returns: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          invoice_id: string | null;
          note: string | null;
          refund_method: Database["public"]["Enums"]["payment_method"] | null;
          return_number: string;
          subtotal: number;
          supplier_id: string | null;
          tax: number;
          total: number;
          warehouse_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          invoice_id?: string | null;
          note?: string | null;
          refund_method?: Database["public"]["Enums"]["payment_method"] | null;
          return_number: string;
          subtotal?: number;
          supplier_id?: string | null;
          tax?: number;
          total?: number;
          warehouse_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          invoice_id?: string | null;
          note?: string | null;
          refund_method?: Database["public"]["Enums"]["payment_method"] | null;
          return_number?: string;
          subtotal?: number;
          supplier_id?: string | null;
          tax?: number;
          total?: number;
          warehouse_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_returns_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "purchase_invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_returns_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_returns_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_invoice_items: {
        Row: {
          base_unit_price: number | null;
          base_quantity: number | null;
          discount: number;
          entered_quantity: number | null;
          entered_unit_price: number | null;
          id: string;
          invoice_id: string;
          product_id: string;
          quantity: number;
          tax: number;
          total: number;
          unit_price: number;
          uom_conversion_factor: number | null;
          uom_id: string | null;
          uom_quantity_increment: number | null;
        };
        Insert: {
          base_unit_price?: number | null;
          base_quantity?: number | null;
          discount?: number;
          entered_quantity?: number | null;
          entered_unit_price?: number | null;
          id?: string;
          invoice_id: string;
          product_id: string;
          quantity: number;
          tax?: number;
          total: number;
          unit_price: number;
          uom_conversion_factor?: number | null;
          uom_id?: string | null;
          uom_quantity_increment?: number | null;
        };
        Update: {
          base_unit_price?: number | null;
          base_quantity?: number | null;
          discount?: number;
          entered_quantity?: number | null;
          entered_unit_price?: number | null;
          id?: string;
          invoice_id?: string;
          product_id?: string;
          quantity?: number;
          tax?: number;
          total?: number;
          unit_price?: number;
          uom_conversion_factor?: number | null;
          uom_id?: string | null;
          uom_quantity_increment?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "sales_invoice_items_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "sales_invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_invoice_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_invoices: {
        Row: {
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          discount: number;
          id: string;
          invoice_number: string;
          note: string | null;
          paid: number;
          payment_method: Database["public"]["Enums"]["payment_method"] | null;
          status: Database["public"]["Enums"]["invoice_status"];
          subtotal: number;
          tax: number;
          total: number;
          updated_at: string;
          warehouse_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          discount?: number;
          id?: string;
          invoice_number: string;
          note?: string | null;
          paid?: number;
          payment_method?: Database["public"]["Enums"]["payment_method"] | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          subtotal?: number;
          tax?: number;
          total?: number;
          updated_at?: string;
          warehouse_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          discount?: number;
          id?: string;
          invoice_number?: string;
          note?: string | null;
          paid?: number;
          payment_method?: Database["public"]["Enums"]["payment_method"] | null;
          status?: Database["public"]["Enums"]["invoice_status"];
          subtotal?: number;
          tax?: number;
          total?: number;
          updated_at?: string;
          warehouse_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sales_invoices_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_invoices_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_return_items: {
        Row: {
          base_quantity: number | null;
          entered_quantity: number | null;
          entered_unit_price: number | null;
          id: string;
          invoice_item_id: string | null;
          product_id: string;
          quantity: number;
          return_id: string;
          tax: number;
          total: number;
          unit_price: number;
          uom_conversion_factor: number | null;
          uom_id: string | null;
          uom_quantity_increment: number | null;
        };
        Insert: {
          base_quantity?: number | null;
          entered_quantity?: number | null;
          entered_unit_price?: number | null;
          id?: string;
          invoice_item_id?: string | null;
          product_id: string;
          quantity: number;
          return_id: string;
          tax?: number;
          total?: number;
          unit_price: number;
          uom_conversion_factor?: number | null;
          uom_id?: string | null;
          uom_quantity_increment?: number | null;
        };
        Update: {
          base_quantity?: number | null;
          entered_quantity?: number | null;
          entered_unit_price?: number | null;
          id?: string;
          invoice_item_id?: string | null;
          product_id?: string;
          quantity?: number;
          return_id?: string;
          tax?: number;
          total?: number;
          unit_price?: number;
          uom_conversion_factor?: number | null;
          uom_id?: string | null;
          uom_quantity_increment?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "sales_return_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_return_items_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: false;
            referencedRelation: "sales_returns";
            referencedColumns: ["id"];
          },
        ];
      };
      sales_returns: {
        Row: {
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          id: string;
          invoice_id: string | null;
          note: string | null;
          refund_method: Database["public"]["Enums"]["payment_method"] | null;
          return_number: string;
          subtotal: number;
          tax: number;
          total: number;
          warehouse_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          invoice_id?: string | null;
          note?: string | null;
          refund_method?: Database["public"]["Enums"]["payment_method"] | null;
          return_number: string;
          subtotal?: number;
          tax?: number;
          total?: number;
          warehouse_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          id?: string;
          invoice_id?: string | null;
          note?: string | null;
          refund_method?: Database["public"]["Enums"]["payment_method"] | null;
          return_number?: string;
          subtotal?: number;
          tax?: number;
          total?: number;
          warehouse_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sales_returns_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_returns_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "sales_invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_returns_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          adjustment_reason: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          movement_type: Database["public"]["Enums"]["movement_type"];
          note: string | null;
          product_id: string;
          quantity: number;
          reference: string | null;
          reference_id: string | null;
          reference_type: string | null;
          unit_cost: number | null;
          warehouse_id: string;
        };
        Insert: {
          adjustment_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          movement_type: Database["public"]["Enums"]["movement_type"];
          note?: string | null;
          product_id: string;
          quantity: number;
          reference?: string | null;
          reference_id?: string | null;
          reference_type?: string | null;
          unit_cost?: number | null;
          warehouse_id: string;
        };
        Update: {
          adjustment_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          movement_type?: Database["public"]["Enums"]["movement_type"];
          note?: string | null;
          product_id?: string;
          quantity?: number;
          reference?: string | null;
          reference_id?: string | null;
          reference_type?: string | null;
          unit_cost?: number | null;
          warehouse_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey";
            columns: ["warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_transfer_items: {
        Row: {
          id: string;
          product_id: string;
          quantity: number;
          transfer_id: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          quantity: number;
          transfer_id: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          quantity?: number;
          transfer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey";
            columns: ["transfer_id"];
            isOneToOne: false;
            referencedRelation: "stock_transfers";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_transfers: {
        Row: {
          created_at: string;
          created_by: string | null;
          from_warehouse_id: string;
          id: string;
          note: string | null;
          status: string;
          to_warehouse_id: string;
          transfer_number: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          from_warehouse_id: string;
          id?: string;
          note?: string | null;
          status?: string;
          to_warehouse_id: string;
          transfer_number: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          from_warehouse_id?: string;
          id?: string;
          note?: string | null;
          status?: string;
          to_warehouse_id?: string;
          transfer_number?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_warehouse_id_fkey";
            columns: ["from_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfers_to_warehouse_id_fkey";
            columns: ["to_warehouse_id"];
            isOneToOne: false;
            referencedRelation: "warehouses";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          address: string | null;
          balance: number;
          created_at: string;
          email: string | null;
          id: string;
          is_active: boolean;
          is_system: boolean;
          name: string;
          phone: string | null;
          system_key: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          balance?: number;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          name: string;
          phone?: string | null;
          system_key?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          balance?: number;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          name?: string;
          phone?: string | null;
          system_key?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      units: {
        Row: {
          created_at: string;
          dimension_code: string;
          factor_to_reference: number | null;
          id: string;
          name: string;
          name_ar: string | null;
          short_name: string;
        };
        Insert: {
          created_at?: string;
          dimension_code?: string;
          factor_to_reference?: number | null;
          id?: string;
          name: string;
          name_ar?: string | null;
          short_name: string;
        };
        Update: {
          created_at?: string;
          dimension_code?: string;
          factor_to_reference?: number | null;
          id?: string;
          name?: string;
          name_ar?: string | null;
          short_name?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      warehouses: {
        Row: {
          address: string | null;
          code: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          is_default: boolean;
          name: string;
          name_ar: string | null;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          code?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          name: string;
          name_ar?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          code?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_default?: boolean;
          name?: string;
          name_ar?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      document_numbering: {
        Row: {
          current_value: number;
          date_part: string;
          document_type: string;
          format_tokens: string;
          id: string;
          is_active: boolean;
          label_ar: string;
          label_en: string;
          padding: number;
          prefix: string;
          reset_policy: string;
          scope: string;
          scope_id: string | null;
          section: string;
          separator: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          current_value?: number;
          date_part?: string;
          document_type: string;
          format_tokens?: string;
          id?: string;
          is_active?: boolean;
          label_ar?: string;
          label_en?: string;
          padding?: number;
          prefix?: string;
          reset_policy?: string;
          scope?: string;
          scope_id?: string | null;
          section?: string;
          separator?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          current_value?: number;
          date_part?: string;
          document_type?: string;
          format_tokens?: string;
          id?: string;
          is_active?: boolean;
          label_ar?: string;
          label_en?: string;
          padding?: number;
          prefix?: string;
          reset_policy?: string;
          scope?: string;
          scope_id?: string | null;
          section?: string;
          separator?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      activate_fixed_asset: {
        Args: {
          p_asset_id: string;
        };
        Returns: boolean;
      };
      adjust_loyalty: {
        Args: {
          _customer: string;
          _points: number;
          _kind: string;
          _note: string;
        };
        Returns: string;
      };
      backup_export_all: {
        Args: {
          p_max_log_rows?: number;
        };
        Returns: Json;
      };
      backup_restore_all: {
        Args: {
          p_payload: Json;
        };
        Returns: Json;
      };
      backup_schema_fingerprint: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      can_author_payment_methods: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      can_operate_milling: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      can_read_expense_entry: {
        Args: {
          p_entry_id: string;
          p_user: string;
        };
        Returns: boolean;
      };
      can_read_finance: {
        Args: {
          p_user: string;
        };
        Returns: boolean;
      };
      can_view_milling: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      cancel_expense: {
        Args: {
          p_entry_id: string;
          p_reason: string;
          p_expected_version?: number;
        };
        Returns: string;
      };
      close_expense: {
        Args: {
          p_entry_id: string;
        };
        Returns: string;
      };
      close_fiscal_year: {
        Args: {
          p_year: number;
        };
        Returns: string;
      };
      consume_internal_supplies: {
        Args: {
          _warehouse_id: string;
          _lines: Json;
          _notes: string;
        };
        Returns: string;
      };
      create_expense: {
        Args: {
          p_lines: Json;
          p_expense_date?: string;
          p_due_date?: string;
          p_entry_type?: string;
          p_payee_type?: string;
          p_payee_name?: string;
          p_supplier_id?: string;
          p_employee_id?: string;
          p_warehouse_id?: string;
          p_cost_center_id?: string;
          p_project_id?: string;
          p_description?: string;
          p_note?: string;
          p_tax_mode?: string;
          p_reference?: string;
          p_submit?: boolean;
        };
        Returns: string;
      };
      create_journal_entry: {
        Args: {
          p_memo: string;
          p_entry_date: string;
          p_source_type: string;
          p_source_id: string;
          p_is_system: boolean;
          p_lines: Json;
        };
        Returns: string;
      };
      create_milling_service_document: {
        Args: {
          _customer_id: string;
          _warehouse_id: string;
          _grain_item_id: string;
          _bags: number;
          _kg: number;
          _service_item_id: string;
          _service_unit_price: number;
          _discount: number;
          _payment_method: string;
          _paid: number;
          _notes: string;
        };
        Returns: Json;
      };
      create_purchase: {
        Args: {
          _warehouse_id: string;
          _supplier_id: string;
          _payment_method: string;
          _paid: number;
          _discount: number;
          _note: string;
          _items: Json;
        };
        Returns: string;
      };
      create_purchase_return: {
        Args: {
          _invoice_id: string;
          _warehouse_id: string;
          _supplier_id: string;
          _refund_method: string;
          _note: string;
          _items: Json;
        };
        Returns: string;
      };
      create_sale: {
        Args: {
          _warehouse_id: string;
          _customer_id: string;
          _payment_method: string;
          _paid: number;
          _discount: number;
          _note: string;
          _items: Json;
        };
        Returns: string;
      };
      create_sales_return: {
        Args: {
          _invoice_id: string;
          _warehouse_id: string;
          _customer_id: string;
          _refund_method: string;
          _note: string;
          _items: Json;
        };
        Returns: string;
      };
      create_stock_transfer: {
        Args: {
          _from: string;
          _to: string;
          _note: string;
          _items: Json;
        };
        Returns: string;
      };
      create_tenant_payment_method: {
        Args: {
          p_name_ar: string;
          p_name_en: string;
          p_icon_key: string;
          p_legacy_id: string;
          p_ledger_kind: string;
          p_contexts?: string[];
          p_requires_reference?: boolean;
        };
        Returns: string;
      };
      custody_intake: {
        Args: {
          _customer_id: string;
          _warehouse_id: string;
          _item_id: string;
          _bags: number;
          _kg: number;
          _notes: string;
        };
        Returns: string;
      };
      custody_link_invoice: {
        Args: {
          _custody_entry_id: string;
          _invoice_id: string;
        };
        Returns: string;
      };
      custody_milling: {
        Args: {
          _customer_id: string;
          _warehouse_id: string;
          _grain_item_id: string;
          _bags_out: number;
          _kg_out: number;
          _outputs: Json;
          _notes: string;
        };
        Returns: string;
      };
      customer_credit_limit_allows: {
        Args: {
          p_customer_id: string;
          p_new_due: number;
        };
        Returns: boolean;
      };
      decide_expense: {
        Args: {
          p_entry_id: string;
          p_approve: boolean;
          p_reason?: string;
          p_expected_version?: number;
        };
        Returns: string;
      };
      delete_expense_category: {
        Args: {
          p_id: string;
        };
        Returns: string;
      };
      dispose_fixed_asset: {
        Args: {
          p_asset_id: string;
          p_disposal_date: string;
          p_proceeds?: number;
          p_proceeds_account?: string;
        };
        Returns: string;
      };
      expense_detail: {
        Args: {
          p_entry_id: string;
        };
        Returns: Json;
      };
      expense_lookups: {
        Args: {
          p_include_archived?: boolean;
        };
        Returns: Json;
      };
      expense_report: {
        Args: {
          p_group_by?: string;
          p_date_from?: string;
          p_date_to?: string;
          p_status?: string[];
          p_warehouse_id?: string;
          p_cost_center_id?: string;
          p_project_id?: string;
          p_limit?: number;
        };
        Returns: Json[];
      };
      expense_summary: {
        Args: {
          p_date_from?: string;
          p_date_to?: string;
          p_warehouse_id?: string;
        };
        Returns: Json;
      };
      fn_format_document_number: {
        Args: {
          p_sequence: number;
          p_prefix: string;
          p_format: string;
          p_padding: number;
          p_separator: string;
          p_date_part: string;
          p_at?: string;
        };
        Returns: string;
      };
      fn_next_document_number: {
        Args: {
          p_document_type: string;
          p_company_id?: string;
          p_branch_id?: string;
          p_pos_id?: string;
          p_at?: string;
        };
        Returns: string;
      };
      fn_resolve_document_numbering: {
        Args: {
          p_document_type: string;
          p_company_id?: string;
          p_branch_id?: string;
          p_pos_id?: string;
        };
        Returns: string;
      };
      fn_set_document_numbering: {
        Args: {
          p_document_type: string;
          p_prefix?: string;
          p_format_tokens?: string;
          p_padding?: number;
          p_date_part?: string;
          p_separator?: string;
          p_reset_policy?: string;
          p_next_value?: number;
        };
        Returns: string;
      };
      generate_tax_declaration: {
        Args: {
          p_start_date: string;
          p_end_date: string;
        };
        Returns: Json;
      };
      get_chart_of_accounts_tree: {
        Args: Record<PropertyKey, never>;
        Returns: Json[];
      };
      get_supplier_statement: {
        Args: {
          p_supplier_id: string;
          p_start_date?: string;
          p_end_date?: string;
        };
        Returns: Json[];
      };
      has_role: {
        Args: {
          _user_id: string;
          _role: string;
        };
        Returns: boolean;
      };
      is_platform_admin: {
        Args: {
          p_user_id: string;
        };
        Returns: boolean;
      };
      is_platform_superadmin: {
        Args: {
          p_user_id: string;
        };
        Returns: boolean;
      };
      is_staff: {
        Args: {
          _user_id: string;
        };
        Returns: boolean;
      };
      is_system_customer: {
        Args: {
          p_customer_id: string;
        };
        Returns: boolean;
      };
      is_system_supplier: {
        Args: {
          p_supplier_id: string;
        };
        Returns: boolean;
      };
      item_effective_policy: {
        Args: {
          p_item_id: string;
        };
        Returns: string;
      };
      item_has_stock_history: {
        Args: {
          p_item_id: string;
        };
        Returns: boolean;
      };
      item_line_type: {
        Args: {
          p_item_id: string;
          p_is_ad_hoc?: boolean;
        };
        Returns: string;
      };
      item_stock_effect: {
        Args: {
          p_item_id: string;
          p_direction: string;
        };
        Returns: string;
      };
      ledger_account_code_for_payment_method: {
        Args: {
          p_payment_method: string;
        };
        Returns: string;
      };
      list_expenses: {
        Args: {
          p_search?: string;
          p_status?: string[];
          p_category_id?: string;
          p_warehouse_id?: string;
          p_cost_center_id?: string;
          p_project_id?: string;
          p_supplier_id?: string;
          p_employee_id?: string;
          p_payment_state?: string;
          p_date_from?: string;
          p_date_to?: string;
          p_amount_min?: number;
          p_amount_max?: number;
          p_category_ids?: string[];
          p_limit?: number;
          p_cursor_date?: string;
          p_cursor_id?: string;
        };
        Returns: Json[];
      };
      open_fiscal_year: {
        Args: {
          p_year: number;
        };
        Returns: number;
      };
      pay_tax_settlement: {
        Args: {
          p_settlement_id: string;
          p_payment_date?: string;
          p_payment_account?: string;
        };
        Returns: string;
      };
      payment_method_ledger_account: {
        Args: {
          p_stored: string;
        };
        Returns: string;
      };
      post_expense: {
        Args: {
          p_entry_id: string;
          p_expected_version?: number;
          p_pay_now?: boolean;
          p_payment_method?: string;
          p_account_label?: string;
          p_payment_date?: string;
          p_idempotency_key?: string;
          p_account_id?: string;
        };
        Returns: string;
      };
      post_purchase_invoice: {
        Args: {
          p_invoice_id: string;
        };
        Returns: string;
      };
      post_sales_invoice: {
        Args: {
          p_invoice_id: string;
        };
        Returns: string;
      };
      post_stock_delta: {
        Args: {
          p_product_id: string;
          p_warehouse_id: string;
          p_signed_qty: number;
          p_unit_cost?: number;
          p_movement_kind?: string;
          p_source_type?: string;
          p_source_id?: string;
          p_note?: string;
          p_owner_type?: string;
          p_owner_id?: string;
          p_movement_type_legacy?: string;
        };
        Returns: string;
      };
      post_stock_settlement: {
        Args: {
          p_warehouse_id: string;
          p_reason: string;
          p_note: string | null;
          p_lines: Json;
        };
        Returns: string;
      };
      product_reference_counts: {
        Args: {
          p_product_id: string;
        };
        Returns: Json;
      };
      record_customer_payment: {
        Args: {
          _customer_id: string;
          _invoice_id: string;
          _amount: number;
          _method: string;
          _payment_date: string;
          _note: string;
        };
        Returns: string;
      };
      record_expense_payment: {
        Args: {
          p_entry_id: string;
          p_amount: number;
          p_payment_date?: string;
          p_payment_method?: string;
          p_account_label?: string;
          p_reference_no?: string;
          p_note?: string;
          p_idempotency_key?: string;
          p_account_id?: string;
        };
        Returns: string;
      };
      record_supplier_payment: {
        Args: {
          p_supplier_id: string;
          p_amount: number;
          p_payment_method?: string;
          p_account_code?: string;
          p_payment_date?: string;
          p_notes?: string;
          p_due_date?: string;
        };
        Returns: Json;
      };
      remove_tenant_payment_method: {
        Args: {
          p_id: string;
        };
        Returns: string;
      };
      resolve_unit_cost: {
        Args: {
          p_product_id: string;
          p_warehouse_id?: string;
          p_as_of?: string;
        };
        Returns: number;
      };
      resolve_product_barcode: {
        Args: {
          _barcode: string;
          _company_id?: number;
        };
        Returns: {
          product_id: string;
          uom_id: string | null;
          factor_to_base: number;
          sale_price: number;
        }[];
      };
      save_product_uom_settings: {
        Args: {
          _product_id: string;
          _units: Json;
          _barcodes?: Json;
          _company_id?: number;
        };
        Returns: undefined;
      };
      reverse_expense: {
        Args: {
          p_entry_id: string;
          p_reason?: string;
        };
        Returns: string;
      };
      reverse_expense_payment: {
        Args: {
          p_payment_id: string;
          p_reason?: string;
        };
        Returns: string;
      };
      reverse_journal_entry: {
        Args: {
          p_entry_id: string;
          p_reason: string;
        };
        Returns: string;
      };
      run_batch_amortization: {
        Args: {
          p_date?: string;
        };
        Returns: Json;
      };
      run_batch_depreciation: {
        Args: {
          p_date?: string;
        };
        Returns: Json;
      };
      run_contract_amortization: {
        Args: {
          p_contract_id: string;
          p_date?: string;
        };
        Returns: string;
      };
      run_depreciation: {
        Args: {
          p_asset_id: string;
          p_date?: string;
        };
        Returns: string;
      };
      save_expense_category: {
        Args: {
          p_id?: string;
          p_name?: string;
          p_name_ar?: string;
          p_sort_order?: number;
          p_notes?: string;
          p_is_active?: boolean;
        };
        Returns: string;
      };
      search_products: {
        Args: {
          p_query?: string;
          p_category_id?: string;
          p_brand_id?: string;
          p_unit_id?: string;
          p_origin_id?: string;
          p_active?: boolean;
          p_low_stock?: boolean;
          p_sort_key?: string;
          p_sort_dir?: string;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json[];
      };
      set_period_status: {
        Args: {
          p_period_id: string;
          p_status: string;
        };
        Returns: boolean;
      };
      settle_tax_period: {
        Args: {
          p_start_date: string;
          p_end_date: string;
          p_period_number: string;
          p_settlement_date?: string;
        };
        Returns: string;
      };
      smart_manufacture: {
        Args: {
          _warehouse_id: string;
          _grain_item_id: string;
          _grain_qty: number;
          _outputs: Json;
          _notes: string;
        };
        Returns: string;
      };
      submit_expense: {
        Args: {
          p_entry_id: string;
          p_expected_version?: number;
        };
        Returns: string;
      };
      update_expense: {
        Args: {
          p_entry_id: string;
          p_expected_version: number;
          p_lines: Json;
          p_expense_date?: string;
          p_due_date?: string;
          p_entry_type?: string;
          p_payee_type?: string;
          p_payee_name?: string;
          p_supplier_id?: string;
          p_employee_id?: string;
          p_warehouse_id?: string;
          p_cost_center_id?: string;
          p_project_id?: string;
          p_description?: string;
          p_note?: string;
          p_tax_mode?: string;
        };
        Returns: string;
      };
      update_payment_method_identity: {
        Args: {
          p_id: string;
          p_name_ar?: string;
          p_name_en?: string;
          p_icon_key?: string;
        };
        Returns: Json[];
      };
      warehouse_reference_counts: {
        Args: {
          p_warehouse_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      app_role: "owner" | "manager" | "accountant" | "cashier" | "warehouse";
      invoice_status:
        | "draft"
        | "confirmed"
        | "paid"
        | "unpaid"
        | "partial"
        | "cancelled"
        | "returned"
        | "received"
        | "completed";
      movement_type:
        | "purchase"
        | "sale"
        | "adjustment"
        | "transfer_in"
        | "transfer_out"
        | "return_in"
        | "return_out"
        | "opening"
        | "purchase_return"
        | "sale_return";
      payment_method:
        "cash" | "card" | "bank_transfer" | "credit" | "mobile_money" | "split" | "cheque";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "manager", "accountant", "cashier", "warehouse"],
      invoice_status: [
        "draft",
        "confirmed",
        "paid",
        "unpaid",
        "partial",
        "cancelled",
        "returned",
        "received",
        "completed",
      ],
      movement_type: [
        "purchase",
        "sale",
        "adjustment",
        "transfer_in",
        "transfer_out",
        "return_in",
        "return_out",
        "opening",
        "purchase_return",
        "sale_return",
      ],
      payment_method: [
        "cash",
        "card",
        "bank_transfer",
        "credit",
        "mobile_money",
        "split",
        "cheque",
      ],
    },
  },
} as const;
