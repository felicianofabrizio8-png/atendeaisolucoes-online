export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          business_hours_end: string
          business_hours_start: string
          company_id: string
          created_at: string
          greeting_message: string | null
          signature: string | null
          sla_minutes: number
          updated_at: string
        }
        Insert: {
          business_hours_end?: string
          business_hours_start?: string
          company_id: string
          created_at?: string
          greeting_message?: string | null
          signature?: string | null
          sla_minutes?: number
          updated_at?: string
        }
        Update: {
          business_hours_end?: string
          business_hours_start?: string
          company_id?: string
          created_at?: string
          greeting_message?: string | null
          signature?: string | null
          sla_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          awaiting_reply: boolean
          channel: Database["public"]["Enums"]["channel"]
          company_id: string
          created_at: string
          id: string
          last_message_at: string
          lead_id: string
          unread: number
          updated_at: string
        }
        Insert: {
          awaiting_reply?: boolean
          channel: Database["public"]["Enums"]["channel"]
          company_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          lead_id: string
          unread?: number
          updated_at?: string
        }
        Update: {
          awaiting_reply?: boolean
          channel?: Database["public"]["Enums"]["channel"]
          company_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          lead_id?: string
          unread?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          access_token: string | null
          account_metadata: Json
          active: boolean
          channel: Database["public"]["Enums"]["channel"]
          company_id: string
          created_at: string
          display_name: string
          external_account_id: string | null
          has_access_token: boolean
          has_webhook_secret: boolean
          id: string
          last_error: string | null
          last_synced_at: string | null
          token_expires_at: string | null
          updated_at: string
          verify_token: string | null
          webhook_secret: string | null
        }
        Insert: {
          access_token?: string | null
          account_metadata?: Json
          active?: boolean
          channel: Database["public"]["Enums"]["channel"]
          company_id: string
          created_at?: string
          display_name: string
          external_account_id?: string | null
          has_access_token?: boolean
          has_webhook_secret?: boolean
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
          verify_token?: string | null
          webhook_secret?: string | null
        }
        Update: {
          access_token?: string | null
          account_metadata?: Json
          active?: boolean
          channel?: Database["public"]["Enums"]["channel"]
          company_id?: string
          created_at?: string
          display_name?: string
          external_account_id?: string | null
          has_access_token?: boolean
          has_webhook_secret?: boolean
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
          verify_token?: string | null
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          channel: Database["public"]["Enums"]["channel"]
          closed_at: string | null
          closed_value: number | null
          company_id: string
          created_at: string
          estimated_value: number | null
          external_id: string | null
          handle: string | null
          id: string
          integration_id: string | null
          loss_reason: string | null
          lost_at: string | null
          name: string
          next_action_due_at: string | null
          next_action_label: string | null
          phone: string | null
          product: string | null
          source: string | null
          source_page_id: string | null
          source_sender_id: string | null
          status: Database["public"]["Enums"]["lead_status"]
          tags: string[]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          channel: Database["public"]["Enums"]["channel"]
          closed_at?: string | null
          closed_value?: number | null
          company_id: string
          created_at?: string
          estimated_value?: number | null
          external_id?: string | null
          handle?: string | null
          id?: string
          integration_id?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          name: string
          next_action_due_at?: string | null
          next_action_label?: string | null
          phone?: string | null
          product?: string | null
          source?: string | null
          source_page_id?: string | null
          source_sender_id?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          tags?: string[]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          channel?: Database["public"]["Enums"]["channel"]
          closed_at?: string | null
          closed_value?: number | null
          company_id?: string
          created_at?: string
          estimated_value?: number | null
          external_id?: string | null
          handle?: string | null
          id?: string
          integration_id?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          name?: string
          next_action_due_at?: string | null
          next_action_label?: string | null
          phone?: string | null
          product?: string | null
          source?: string | null
          source_page_id?: string | null
          source_sender_id?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_reasons: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "loss_reasons_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          at: string
          company_id: string
          conversation_id: string
          created_at: string
          external_id: string | null
          id: string
          integration_id: string | null
          role: Database["public"]["Enums"]["message_role"]
          source: string | null
          source_metadata: Json
          source_subtype: string | null
          text: string
        }
        Insert: {
          at?: string
          company_id: string
          conversation_id: string
          created_at?: string
          external_id?: string | null
          id?: string
          integration_id?: string | null
          role: Database["public"]["Enums"]["message_role"]
          source?: string | null
          source_metadata?: Json
          source_subtype?: string | null
          text: string
        }
        Update: {
          at?: string
          company_id?: string
          conversation_id?: string
          created_at?: string
          external_id?: string | null
          id?: string
          integration_id?: string | null
          role?: Database["public"]["Enums"]["message_role"]
          source?: string | null
          source_metadata?: Json
          source_subtype?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_pages: {
        Row: {
          active: boolean
          company_id: string
          created_at: string
          id: string
          ig_business_account_id: string | null
          ig_username: string | null
          integration_id: string | null
          last_error: string | null
          page_access_token: string
          page_id: string
          page_name: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id: string
          created_at?: string
          id?: string
          ig_business_account_id?: string | null
          ig_username?: string | null
          integration_id?: string | null
          last_error?: string | null
          page_access_token: string
          page_id: string
          page_name: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          created_at?: string
          id?: string
          ig_business_account_id?: string | null
          ig_username?: string | null
          integration_id?: string | null
          last_error?: string | null
          page_access_token?: string
          page_id?: string
          page_name?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          category: string | null
          company_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          notes: string | null
          price: number | null
          promo_price: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          price?: number | null
          promo_price?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          price?: number | null
          promo_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          company_id: string
          conversation_id: string | null
          created_at: string
          discount: number
          final_value: number
          id: string
          installments: number
          items: Json
          lead_id: string | null
          message: string | null
          notes: string | null
          payment_method: string | null
          product_id: string | null
          product_name: string | null
          sent: boolean
          status: Database["public"]["Enums"]["quote_status"]
          total: number
          unit_price: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          company_id: string
          conversation_id?: string | null
          created_at?: string
          discount?: number
          final_value?: number
          id?: string
          installments?: number
          items?: Json
          lead_id?: string | null
          message?: string | null
          notes?: string | null
          payment_method?: string | null
          product_id?: string | null
          product_name?: string | null
          sent?: boolean
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number
          unit_price?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          discount?: number
          final_value?: number
          id?: string
          installments?: number
          items?: Json
          lead_id?: string | null
          message?: string | null
          notes?: string | null
          payment_method?: string | null
          product_id?: string | null
          product_name?: string | null
          sent?: boolean
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number
          unit_price?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          address: string | null
          company_id: string
          created_at: string
          id: string
          lead_id: string | null
          notes: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          title: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          company_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["visit_status"]
          title: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          company_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["visit_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          company_id: string
          created_at: string
          direction: string
          id: string
          mensagem: string
          numero: string
          origem: string | null
          push_name: string | null
          whatsapp_jid: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          direction?: string
          id?: string
          mensagem: string
          numero: string
          origem?: string | null
          push_name?: string | null
          whatsapp_jid?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          direction?: string
          id?: string
          mensagem?: string
          numero?: string
          origem?: string | null
          push_name?: string | null
          whatsapp_jid?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      integrations_safe: {
        Row: {
          account_metadata: Json | null
          active: boolean | null
          channel: Database["public"]["Enums"]["channel"] | null
          company_id: string | null
          created_at: string | null
          display_name: string | null
          external_account_id: string | null
          has_access_token: boolean | null
          has_webhook_secret: boolean | null
          id: string | null
          last_error: string | null
          last_synced_at: string | null
          updated_at: string | null
        }
        Insert: {
          account_metadata?: Json | null
          active?: boolean | null
          channel?: Database["public"]["Enums"]["channel"] | null
          company_id?: string | null
          created_at?: string | null
          display_name?: string | null
          external_account_id?: string | null
          has_access_token?: boolean | null
          has_webhook_secret?: boolean | null
          id?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          updated_at?: string | null
        }
        Update: {
          account_metadata?: Json | null
          active?: boolean | null
          channel?: Database["public"]["Enums"]["channel"] | null
          company_id?: string | null
          created_at?: string | null
          display_name?: string | null
          external_account_id?: string | null
          has_access_token?: boolean | null
          has_webhook_secret?: boolean | null
          id?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_company_id: { Args: never; Returns: string }
    }
    Enums: {
      channel: "whatsapp" | "instagram" | "facebook"
      lead_status:
        | "novo"
        | "aguardando"
        | "quente"
        | "morno"
        | "frio"
        | "fechado"
        | "perdido"
      message_role: "lead" | "agent" | "system"
      quote_status: "rascunho" | "enviado" | "aceito" | "recusado" | "expirado"
      visit_status: "agendada" | "concluida" | "cancelada" | "remarcada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      channel: ["whatsapp", "instagram", "facebook"],
      lead_status: [
        "novo",
        "aguardando",
        "quente",
        "morno",
        "frio",
        "fechado",
        "perdido",
      ],
      message_role: ["lead", "agent", "system"],
      quote_status: ["rascunho", "enviado", "aceito", "recusado", "expirado"],
      visit_status: ["agendada", "concluida", "cancelada", "remarcada"],
    },
  },
} as const
