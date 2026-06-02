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
      ai_flow_events: {
        Row: {
          company_id: string
          conversation_id: string | null
          created_at: string
          event_type: string
          id: string
          lead_id: string | null
          payload: Json
        }
        Insert: {
          company_id: string
          conversation_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          lead_id?: string | null
          payload?: Json
        }
        Update: {
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string | null
          payload?: Json
        }
        Relationships: []
      }
      ai_knowledge_proposals: {
        Row: {
          answer: string
          company_id: string
          created_at: string
          id: string
          question: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_conversation_id: string | null
          status: Database["public"]["Enums"]["ai_proposal_status"]
          type: Database["public"]["Enums"]["ai_proposal_type"]
          updated_at: string
        }
        Insert: {
          answer: string
          company_id: string
          created_at?: string
          id?: string
          question: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_conversation_id?: string | null
          status?: Database["public"]["Enums"]["ai_proposal_status"]
          type?: Database["public"]["Enums"]["ai_proposal_type"]
          updated_at?: string
        }
        Update: {
          answer?: string
          company_id?: string
          created_at?: string
          id?: string
          question?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_conversation_id?: string | null
          status?: Database["public"]["Enums"]["ai_proposal_status"]
          type?: Database["public"]["Enums"]["ai_proposal_type"]
          updated_at?: string
        }
        Relationships: []
      }
      ai_profiles: {
        Row: {
          avg_lead_time: string | null
          business_hours: string | null
          company_id: string
          company_name: string | null
          created_at: string
          description: string | null
          differentials: string | null
          faq: Json
          payment_methods: string | null
          products: string | null
          region: string | null
          tone: Database["public"]["Enums"]["ai_tone"]
          updated_at: string
        }
        Insert: {
          avg_lead_time?: string | null
          business_hours?: string | null
          company_id: string
          company_name?: string | null
          created_at?: string
          description?: string | null
          differentials?: string | null
          faq?: Json
          payment_methods?: string | null
          products?: string | null
          region?: string | null
          tone?: Database["public"]["Enums"]["ai_tone"]
          updated_at?: string
        }
        Update: {
          avg_lead_time?: string | null
          business_hours?: string | null
          company_id?: string
          company_name?: string | null
          created_at?: string
          description?: string | null
          differentials?: string | null
          faq?: Json
          payment_methods?: string | null
          products?: string | null
          region?: string | null
          tone?: Database["public"]["Enums"]["ai_tone"]
          updated_at?: string
        }
        Relationships: []
      }
      ai_suggestions_log: {
        Row: {
          classification: string | null
          company_id: string
          conversation_id: string | null
          created_at: string
          generated_text: string
          id: string
          lead_id: string | null
          low_confidence: boolean
          model: string | null
          sent_text: string | null
          user_id: string | null
          was_edited: boolean
          was_sent: boolean
        }
        Insert: {
          classification?: string | null
          company_id: string
          conversation_id?: string | null
          created_at?: string
          generated_text: string
          id?: string
          lead_id?: string | null
          low_confidence?: boolean
          model?: string | null
          sent_text?: string | null
          user_id?: string | null
          was_edited?: boolean
          was_sent?: boolean
        }
        Update: {
          classification?: string | null
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          generated_text?: string
          id?: string
          lead_id?: string | null
          low_confidence?: boolean
          model?: string | null
          sent_text?: string | null
          user_id?: string | null
          was_edited?: boolean
          was_sent?: boolean
        }
        Relationships: []
      }
      ai_usage_counters: {
        Row: {
          company_id: string
          count: number
          month: string
          monthly_limit: number
          updated_at: string
        }
        Insert: {
          company_id: string
          count?: number
          month: string
          monthly_limit?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          count?: number
          month?: string
          monthly_limit?: number
          updated_at?: string
        }
        Relationships: []
      }
      campaign_creatives: {
        Row: {
          audience_suggestion: string | null
          campaign_id: string | null
          company_id: string
          created_at: string
          cta: string | null
          id: string
          image_url: string | null
          primary_text: string | null
          product_id: string | null
          social_caption: string | null
          title: string
          updated_at: string
        }
        Insert: {
          audience_suggestion?: string | null
          campaign_id?: string | null
          company_id: string
          created_at?: string
          cta?: string | null
          id?: string
          image_url?: string | null
          primary_text?: string | null
          product_id?: string | null
          social_caption?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          audience_suggestion?: string | null
          campaign_id?: string | null
          company_id?: string
          created_at?: string
          cta?: string | null
          id?: string
          image_url?: string | null
          primary_text?: string | null
          product_id?: string | null
          social_caption?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          ai_diagnosis: string | null
          city: string | null
          company_id: string
          created_at: string
          cta: string | null
          daily_budget: number | null
          headline: string | null
          id: string
          leads_count: number
          media_type: string | null
          media_url: string | null
          messages_count: number
          meta_campaign_id: string | null
          name: string
          objective: string
          primary_text: string | null
          product: string | null
          radius_km: number | null
          spent: number
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_diagnosis?: string | null
          city?: string | null
          company_id: string
          created_at?: string
          cta?: string | null
          daily_budget?: number | null
          headline?: string | null
          id?: string
          leads_count?: number
          media_type?: string | null
          media_url?: string | null
          messages_count?: number
          meta_campaign_id?: string | null
          name: string
          objective?: string
          primary_text?: string | null
          product?: string | null
          radius_km?: number | null
          spent?: number
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_diagnosis?: string | null
          city?: string | null
          company_id?: string
          created_at?: string
          cta?: string | null
          daily_budget?: number | null
          headline?: string | null
          id?: string
          leads_count?: number
          media_type?: string | null
          media_url?: string | null
          messages_count?: number
          meta_campaign_id?: string | null
          name?: string
          objective?: string
          primary_text?: string | null
          product?: string | null
          radius_km?: number | null
          spent?: number
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
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
          ai_after_hours_only: boolean
          ai_agent_name: string
          ai_auto_reply_enabled: boolean
          ai_followup_business_hours_only: boolean
          ai_followup_daily_limit: number
          ai_followup_delay_jitter_minutes: number
          ai_followup_enabled: boolean
          ai_followup_hot_delay_hours: number
          ai_followup_humanize: boolean
          ai_followup_max_per_lead: number
          ai_followup_min_hours_between: number
          ai_followup_min_response_rate: number
          ai_followup_quote_delay_hours: number
          ai_followup_reactivation_daily_max: number
          ai_followup_reactivation_days: number
          ai_followup_reactivation_enabled: boolean
          ai_followup_reactivation_hours_end: string
          ai_followup_reactivation_hours_start: string
          ai_followup_reactivation_template: string
          ai_followup_silence_delay_hours: number
          ai_followup_templates: Json
          ai_followup_tone: string
          ai_followup_visit_delay_hours: number
          ai_followup_warmup_enabled: boolean
          ai_followup_warmup_started_at: string | null
          ai_handoff_timeout_minutes: number
          ai_initial_message: string | null
          ai_last_test_at: string | null
          ai_last_test_result: Json | null
          ai_max_auto_replies: number
          ai_pilot_enabled_at: string | null
          ai_pilot_mode: boolean
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
          ai_after_hours_only?: boolean
          ai_agent_name?: string
          ai_auto_reply_enabled?: boolean
          ai_followup_business_hours_only?: boolean
          ai_followup_daily_limit?: number
          ai_followup_delay_jitter_minutes?: number
          ai_followup_enabled?: boolean
          ai_followup_hot_delay_hours?: number
          ai_followup_humanize?: boolean
          ai_followup_max_per_lead?: number
          ai_followup_min_hours_between?: number
          ai_followup_min_response_rate?: number
          ai_followup_quote_delay_hours?: number
          ai_followup_reactivation_daily_max?: number
          ai_followup_reactivation_days?: number
          ai_followup_reactivation_enabled?: boolean
          ai_followup_reactivation_hours_end?: string
          ai_followup_reactivation_hours_start?: string
          ai_followup_reactivation_template?: string
          ai_followup_silence_delay_hours?: number
          ai_followup_templates?: Json
          ai_followup_tone?: string
          ai_followup_visit_delay_hours?: number
          ai_followup_warmup_enabled?: boolean
          ai_followup_warmup_started_at?: string | null
          ai_handoff_timeout_minutes?: number
          ai_initial_message?: string | null
          ai_last_test_at?: string | null
          ai_last_test_result?: Json | null
          ai_max_auto_replies?: number
          ai_pilot_enabled_at?: string | null
          ai_pilot_mode?: boolean
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
          ai_after_hours_only?: boolean
          ai_agent_name?: string
          ai_auto_reply_enabled?: boolean
          ai_followup_business_hours_only?: boolean
          ai_followup_daily_limit?: number
          ai_followup_delay_jitter_minutes?: number
          ai_followup_enabled?: boolean
          ai_followup_hot_delay_hours?: number
          ai_followup_humanize?: boolean
          ai_followup_max_per_lead?: number
          ai_followup_min_hours_between?: number
          ai_followup_min_response_rate?: number
          ai_followup_quote_delay_hours?: number
          ai_followup_reactivation_daily_max?: number
          ai_followup_reactivation_days?: number
          ai_followup_reactivation_enabled?: boolean
          ai_followup_reactivation_hours_end?: string
          ai_followup_reactivation_hours_start?: string
          ai_followup_reactivation_template?: string
          ai_followup_silence_delay_hours?: number
          ai_followup_templates?: Json
          ai_followup_tone?: string
          ai_followup_visit_delay_hours?: number
          ai_followup_warmup_enabled?: boolean
          ai_followup_warmup_started_at?: string | null
          ai_handoff_timeout_minutes?: number
          ai_initial_message?: string | null
          ai_last_test_at?: string | null
          ai_last_test_result?: Json | null
          ai_max_auto_replies?: number
          ai_pilot_enabled_at?: string | null
          ai_pilot_mode?: boolean
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
          ai_handling: boolean
          ai_status: string | null
          auto_reply_count: number
          awaiting_reply: boolean
          channel: Database["public"]["Enums"]["channel"]
          company_id: string
          created_at: string
          customer_stage: string | null
          detected_budget: string | null
          detected_city: string | null
          detected_intent: string | null
          detected_interest: string | null
          detected_objections: string[]
          detected_pool_size: string | null
          detected_state: string | null
          human_takeover_at: string | null
          id: string
          interaction_type: string
          last_auto_reply_at: string | null
          last_message_at: string
          lead_id: string
          lead_ready_to_close: boolean
          lead_score: number
          lead_temperature: string | null
          purchase_timing: string | null
          unread: number
          updated_at: string
        }
        Insert: {
          ai_handling?: boolean
          ai_status?: string | null
          auto_reply_count?: number
          awaiting_reply?: boolean
          channel: Database["public"]["Enums"]["channel"]
          company_id: string
          created_at?: string
          customer_stage?: string | null
          detected_budget?: string | null
          detected_city?: string | null
          detected_intent?: string | null
          detected_interest?: string | null
          detected_objections?: string[]
          detected_pool_size?: string | null
          detected_state?: string | null
          human_takeover_at?: string | null
          id?: string
          interaction_type?: string
          last_auto_reply_at?: string | null
          last_message_at?: string
          lead_id: string
          lead_ready_to_close?: boolean
          lead_score?: number
          lead_temperature?: string | null
          purchase_timing?: string | null
          unread?: number
          updated_at?: string
        }
        Update: {
          ai_handling?: boolean
          ai_status?: string | null
          auto_reply_count?: number
          awaiting_reply?: boolean
          channel?: Database["public"]["Enums"]["channel"]
          company_id?: string
          created_at?: string
          customer_stage?: string | null
          detected_budget?: string | null
          detected_city?: string | null
          detected_intent?: string | null
          detected_interest?: string | null
          detected_objections?: string[]
          detected_pool_size?: string | null
          detected_state?: string | null
          human_takeover_at?: string | null
          id?: string
          interaction_type?: string
          last_auto_reply_at?: string | null
          last_message_at?: string
          lead_id?: string
          lead_ready_to_close?: boolean
          lead_score?: number
          lead_temperature?: string | null
          purchase_timing?: string | null
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
      follow_ups: {
        Row: {
          attempt_number: number
          cancel_reason: string | null
          cancelled_at: string | null
          company_id: string
          conversation_id: string
          created_at: string
          id: string
          lead_id: string | null
          message_text: string
          metadata: Json
          responded_at: string | null
          response_outcome: string | null
          rule_type: string
          scheduled_for: string | null
          sent_at: string
          status: string
          trigger_reason: string | null
          updated_at: string
          variant_seed: number | null
        }
        Insert: {
          attempt_number?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          company_id: string
          conversation_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          message_text: string
          metadata?: Json
          responded_at?: string | null
          response_outcome?: string | null
          rule_type: string
          scheduled_for?: string | null
          sent_at?: string
          status?: string
          trigger_reason?: string | null
          updated_at?: string
          variant_seed?: number | null
        }
        Update: {
          attempt_number?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          company_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          message_text?: string
          metadata?: Json
          responded_at?: string | null
          response_outcome?: string | null
          rule_type?: string
          scheduled_for?: string | null
          sent_at?: string
          status?: string
          trigger_reason?: string | null
          updated_at?: string
          variant_seed?: number | null
        }
        Relationships: []
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
          last_score_at: string | null
          lead_score: number
          lead_temperature_cached: string | null
          loss_reason: string | null
          lost_at: string | null
          name: string
          next_action_due_at: string | null
          next_action_label: string | null
          phone: string | null
          product: string | null
          reactivated_at: string | null
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
          last_score_at?: string | null
          lead_score?: number
          lead_temperature_cached?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          name: string
          next_action_due_at?: string | null
          next_action_label?: string | null
          phone?: string | null
          product?: string | null
          reactivated_at?: string | null
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
          last_score_at?: string | null
          lead_score?: number
          lead_temperature_cached?: string | null
          loss_reason?: string | null
          lost_at?: string | null
          name?: string
          next_action_due_at?: string | null
          next_action_label?: string | null
          phone?: string | null
          product?: string | null
          reactivated_at?: string | null
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
          ig_user_access_token: string | null
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
          ig_user_access_token?: string | null
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
          ig_user_access_token?: string | null
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
          images: Json
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
          images?: Json
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
          images?: Json
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
          brindes: Json
          company_id: string
          conversation_id: string | null
          created_at: string
          discount: number
          external_message_id: string | null
          final_value: number
          id: string
          inclusos: Json
          installments: number
          items: Json
          lead_id: string | null
          message: string | null
          notes: string | null
          payment_method: string | null
          por_conta: Json
          product_id: string | null
          product_name: string | null
          sent: boolean
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          total: number
          unit_price: number
          updated_at: string
          valid_until: string | null
          viewed_at: string | null
        }
        Insert: {
          brindes?: Json
          company_id: string
          conversation_id?: string | null
          created_at?: string
          discount?: number
          external_message_id?: string | null
          final_value?: number
          id?: string
          inclusos?: Json
          installments?: number
          items?: Json
          lead_id?: string | null
          message?: string | null
          notes?: string | null
          payment_method?: string | null
          por_conta?: Json
          product_id?: string | null
          product_name?: string | null
          sent?: boolean
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number
          unit_price?: number
          updated_at?: string
          valid_until?: string | null
          viewed_at?: string | null
        }
        Update: {
          brindes?: Json
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          discount?: number
          external_message_id?: string | null
          final_value?: number
          id?: string
          inclusos?: Json
          installments?: number
          items?: Json
          lead_id?: string | null
          message?: string | null
          notes?: string | null
          payment_method?: string | null
          por_conta?: Json
          product_id?: string | null
          product_name?: string | null
          sent?: boolean
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number
          unit_price?: number
          updated_at?: string
          valid_until?: string | null
          viewed_at?: string | null
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
          appointment_type: Database["public"]["Enums"]["appointment_type"]
          city: string | null
          company_id: string
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          lead_id: string | null
          notes: string | null
          product: string | null
          quote_id: string | null
          salesperson: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["visit_status"]
          technician: string | null
          title: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          city?: string | null
          company_id: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          product?: string | null
          quote_id?: string | null
          salesperson?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["visit_status"]
          technician?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          appointment_type?: Database["public"]["Enums"]["appointment_type"]
          city?: string | null
          company_id?: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          product?: string | null
          quote_id?: string | null
          salesperson?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["visit_status"]
          technician?: string | null
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
      whatsapp_templates: {
        Row: {
          auto_use: boolean
          category: string
          company_id: string
          components: Json
          created_at: string
          id: string
          integration_id: string | null
          language: string
          last_synced_at: string | null
          meta_payload: Json
          meta_template_id: string | null
          name: string
          purpose: string | null
          status: string
          updated_at: string
          variables: Json
        }
        Insert: {
          auto_use?: boolean
          category: string
          company_id: string
          components?: Json
          created_at?: string
          id?: string
          integration_id?: string | null
          language?: string
          last_synced_at?: string | null
          meta_payload?: Json
          meta_template_id?: string | null
          name: string
          purpose?: string | null
          status?: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          auto_use?: boolean
          category?: string
          company_id?: string
          components?: Json
          created_at?: string
          id?: string
          integration_id?: string | null
          language?: string
          last_synced_at?: string | null
          meta_payload?: Json
          meta_template_id?: string | null
          name?: string
          purpose?: string | null
          status?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      whatsapp_unmapped_events: {
        Row: {
          contact_name: string | null
          created_at: string
          display_phone_number: string | null
          from_wa_id: string | null
          id: string
          message_preview: string | null
          payload: Json
          phone_number_id: string
          waba_id: string | null
        }
        Insert: {
          contact_name?: string | null
          created_at?: string
          display_phone_number?: string | null
          from_wa_id?: string | null
          id?: string
          message_preview?: string | null
          payload?: Json
          phone_number_id: string
          waba_id?: string | null
        }
        Update: {
          contact_name?: string | null
          created_at?: string
          display_phone_number?: string | null
          from_wa_id?: string | null
          id?: string
          message_preview?: string | null
          payload?: Json
          phone_number_id?: string
          waba_id?: string | null
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
          token_expires_at: string | null
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
          token_expires_at?: string | null
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
          token_expires_at?: string | null
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
      ai_agent_maintenance: { Args: never; Returns: undefined }
      current_company_id: { Args: never; Returns: string }
    }
    Enums: {
      ai_proposal_status: "pending" | "approved" | "rejected"
      ai_proposal_type:
        | "faq"
        | "objection"
        | "recurring_reply"
        | "sales_pattern"
      ai_tone: "comercial" | "amigavel" | "premium" | "tecnico" | "informal"
      appointment_type:
        | "visita_tecnica"
        | "loja"
        | "retorno_comercial"
        | "pos_venda"
        | "instalacao"
        | "manutencao"
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
      quote_status:
        | "rascunho"
        | "enviado"
        | "visualizado"
        | "aceito"
        | "recusado"
        | "expirado"
      visit_status:
        | "agendada"
        | "confirmada"
        | "em_andamento"
        | "concluida"
        | "cancelada"
        | "remarcada"
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
      ai_proposal_status: ["pending", "approved", "rejected"],
      ai_proposal_type: [
        "faq",
        "objection",
        "recurring_reply",
        "sales_pattern",
      ],
      ai_tone: ["comercial", "amigavel", "premium", "tecnico", "informal"],
      appointment_type: [
        "visita_tecnica",
        "loja",
        "retorno_comercial",
        "pos_venda",
        "instalacao",
        "manutencao",
      ],
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
      quote_status: [
        "rascunho",
        "enviado",
        "visualizado",
        "aceito",
        "recusado",
        "expirado",
      ],
      visit_status: [
        "agendada",
        "confirmada",
        "em_andamento",
        "concluida",
        "cancelada",
        "remarcada",
      ],
    },
  },
} as const
