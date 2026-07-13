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
      agent_jobs: {
        Row: {
          attempts: number
          available_at: string
          company_id: string
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload_json: Json
          priority: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          company_id: string
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload_json?: Json
          priority?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          company_id?: string
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload_json?: Json
          priority?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
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
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          company_id: string
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          ip: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          company_id: string
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          company_id?: string
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          ip?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      billing_usage_events: {
        Row: {
          company_id: string
          created_at: string
          id: string
          metadata: Json
          metric: string
          occurred_at: string
          period_day: string | null
          provider: string | null
          unit: string
          value: number
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          metadata?: Json
          metric: string
          occurred_at?: string
          period_day?: string | null
          provider?: string | null
          unit?: string
          value?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          metric?: string
          occurred_at?: string
          period_day?: string | null
          provider?: string | null
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_usage_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_ai_analyses: {
        Row: {
          campaign_id: string
          company_id: string
          copy_ideas: Json
          created_at: string
          creative_ideas: Json
          diagnosis: Json
          id: string
          metrics_snapshot: Json
          model: string | null
          recommendations: Json
          summary: string | null
        }
        Insert: {
          campaign_id: string
          company_id: string
          copy_ideas?: Json
          created_at?: string
          creative_ideas?: Json
          diagnosis?: Json
          id?: string
          metrics_snapshot?: Json
          model?: string | null
          recommendations?: Json
          summary?: string | null
        }
        Update: {
          campaign_id?: string
          company_id?: string
          copy_ideas?: Json
          created_at?: string
          creative_ideas?: Json
          diagnosis?: Json
          id?: string
          metrics_snapshot?: Json
          model?: string | null
          recommendations?: Json
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_ai_analyses_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_creatives: {
        Row: {
          ai_score: number | null
          analysis: Json
          audience_suggestion: string | null
          campaign_id: string | null
          company_id: string
          config: Json
          created_at: string
          created_by: string | null
          cta: string | null
          description: string | null
          format: string | null
          headline: string | null
          id: string
          image_url: string | null
          parent_creative_id: string | null
          preserve_product: boolean
          primary_text: string | null
          product_id: string | null
          prompt: string | null
          score_details: Json | null
          social_caption: string | null
          source_image_url: string | null
          title: string
          updated_at: string
          variant_label: string | null
        }
        Insert: {
          ai_score?: number | null
          analysis?: Json
          audience_suggestion?: string | null
          campaign_id?: string | null
          company_id: string
          config?: Json
          created_at?: string
          created_by?: string | null
          cta?: string | null
          description?: string | null
          format?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          parent_creative_id?: string | null
          preserve_product?: boolean
          primary_text?: string | null
          product_id?: string | null
          prompt?: string | null
          score_details?: Json | null
          social_caption?: string | null
          source_image_url?: string | null
          title: string
          updated_at?: string
          variant_label?: string | null
        }
        Update: {
          ai_score?: number | null
          analysis?: Json
          audience_suggestion?: string | null
          campaign_id?: string | null
          company_id?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          cta?: string | null
          description?: string | null
          format?: string | null
          headline?: string | null
          id?: string
          image_url?: string | null
          parent_creative_id?: string | null
          preserve_product?: boolean
          primary_text?: string | null
          product_id?: string | null
          prompt?: string | null
          score_details?: Json | null
          social_caption?: string | null
          source_image_url?: string | null
          title?: string
          updated_at?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_creatives_parent_creative_id_fkey"
            columns: ["parent_creative_id"]
            isOneToOne: false
            referencedRelation: "campaign_creatives"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_metrics: {
        Row: {
          campaign_id: string
          clicks: number
          company_id: string
          cpc: number
          cpm: number
          created_at: string
          ctr: number
          id: string
          impressions: number
          leads: number
          messages: number
          metric_date: string | null
          raw: Json
          reach: number
          source: string
          spent: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          clicks?: number
          company_id: string
          cpc?: number
          cpm?: number
          created_at?: string
          ctr?: number
          id?: string
          impressions?: number
          leads?: number
          messages?: number
          metric_date?: string | null
          raw?: Json
          reach?: number
          source?: string
          spent?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          clicks?: number
          company_id?: string
          cpc?: number
          cpm?: number
          created_at?: string
          ctr?: number
          id?: string
          impressions?: number
          leads?: number
          messages?: number
          metric_date?: string | null
          raw?: Json
          reach?: number
          source?: string
          spent?: number
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
          goal: string
          headline: string | null
          id: string
          leads_count: number
          media_type: string | null
          media_url: string | null
          messages_count: number
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          meta_delivery_status: string | null
          meta_last_sync_at: string | null
          meta_publish_error: string | null
          meta_sync_status: string
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
          goal?: string
          headline?: string | null
          id?: string
          leads_count?: number
          media_type?: string | null
          media_url?: string | null
          messages_count?: number
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_delivery_status?: string | null
          meta_last_sync_at?: string | null
          meta_publish_error?: string | null
          meta_sync_status?: string
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
          goal?: string
          headline?: string | null
          id?: string
          leads_count?: number
          media_type?: string | null
          media_url?: string | null
          messages_count?: number
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_delivery_status?: string | null
          meta_last_sync_at?: string | null
          meta_publish_error?: string | null
          meta_sync_status?: string
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
      coach_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_type: string
          company_id: string
          conversation_id: string
          created_at: string
          id: string
          lead_id: string | null
          payload: Json
          resolved_at: string | null
          resolved_by: string | null
          risk_score: number | null
          severity: string
          status: string
          updated_at: string
          urgency_minutes: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: string
          company_id: string
          conversation_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          payload?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          risk_score?: number | null
          severity?: string
          status?: string
          updated_at?: string
          urgency_minutes?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: string
          company_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          payload?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          risk_score?: number | null
          severity?: string
          status?: string
          updated_at?: string
          urgency_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_alerts_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_alerts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_suggestions: {
        Row: {
          company_id: string
          conversation_id: string
          created_at: string
          created_by: string | null
          id: string
          message_id: string | null
          next_action: string | null
          objection_type: string | null
          reasoning: string | null
          risk_score: number | null
          situation: string | null
          status: string
          suggestion_text: string
          urgency: string | null
          used_at: string | null
        }
        Insert: {
          company_id: string
          conversation_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          message_id?: string | null
          next_action?: string | null
          objection_type?: string | null
          reasoning?: string | null
          risk_score?: number | null
          situation?: string | null
          status?: string
          suggestion_text: string
          urgency?: string | null
          used_at?: string | null
        }
        Update: {
          company_id?: string
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          message_id?: string | null
          next_action?: string | null
          objection_type?: string | null
          reasoning?: string | null
          risk_score?: number | null
          situation?: string | null
          status?: string
          suggestion_text?: string
          urgency?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_suggestions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_suggestions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_suggestions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          meta_campaigns_beta: boolean
          name: string
          slug: string | null
          storage_quota_mb: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          meta_campaigns_beta?: boolean
          name: string
          slug?: string | null
          storage_quota_mb?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          meta_campaigns_beta?: boolean
          name?: string
          slug?: string | null
          storage_quota_mb?: number
          updated_at?: string
        }
        Relationships: []
      }
      company_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          cancelled_at: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          cancelled_at?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
        }
        Relationships: []
      }
      company_onboarding: {
        Row: {
          company_id: string
          completed_at: string | null
          completed_steps_json: Json
          current_step: string
          id: string
          progress: number
          started_at: string
          status: Database["public"]["Enums"]["onboarding_status"]
          updated_at: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          completed_steps_json?: Json
          current_step?: string
          id?: string
          progress?: number
          started_at?: string
          status?: Database["public"]["Enums"]["onboarding_status"]
          updated_at?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          completed_steps_json?: Json
          current_step?: string
          id?: string
          progress?: number
          started_at?: string
          status?: Database["public"]["Enums"]["onboarding_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_onboarding_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_onboarding_events: {
        Row: {
          company_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "company_onboarding_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
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
          default_quote_customer_responsibility: string | null
          default_quote_gifts: string | null
          default_quote_included_items: string | null
          greeting_message: string | null
          location: Json | null
          runtime_autonomy_enabled: boolean
          runtime_kill_switch: boolean
          runtime_scheduler_enabled: boolean
          runtime_system_health_enabled: boolean
          runtime_updated_at: string | null
          runtime_updated_by: string | null
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
          default_quote_customer_responsibility?: string | null
          default_quote_gifts?: string | null
          default_quote_included_items?: string | null
          greeting_message?: string | null
          location?: Json | null
          runtime_autonomy_enabled?: boolean
          runtime_kill_switch?: boolean
          runtime_scheduler_enabled?: boolean
          runtime_system_health_enabled?: boolean
          runtime_updated_at?: string | null
          runtime_updated_by?: string | null
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
          default_quote_customer_responsibility?: string | null
          default_quote_gifts?: string | null
          default_quote_included_items?: string | null
          greeting_message?: string | null
          location?: Json | null
          runtime_autonomy_enabled?: boolean
          runtime_kill_switch?: boolean
          runtime_scheduler_enabled?: boolean
          runtime_system_health_enabled?: boolean
          runtime_updated_at?: string | null
          runtime_updated_by?: string | null
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
      conversation_analyzer_state: {
        Row: {
          analyzer_version: string
          attempts: number
          company_id: string
          conversation_id: string
          created_at: string
          id: string
          last_analyzed_at: string | null
          last_content_hash: string | null
          last_error_code: string | null
          last_message_at: string | null
          next_retry_at: string | null
          processing_status: string
          updated_at: string
        }
        Insert: {
          analyzer_version: string
          attempts?: number
          company_id: string
          conversation_id: string
          created_at?: string
          id?: string
          last_analyzed_at?: string | null
          last_content_hash?: string | null
          last_error_code?: string | null
          last_message_at?: string | null
          next_retry_at?: string | null
          processing_status?: string
          updated_at?: string
        }
        Update: {
          analyzer_version?: string
          attempts?: number
          company_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
          last_analyzed_at?: string | null
          last_content_hash?: string | null
          last_error_code?: string | null
          last_message_at?: string | null
          next_retry_at?: string | null
          processing_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_analyzer_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_facts: {
        Row: {
          agent_message_count: number
          analyzed_at: string
          analyzer_version: string
          buying_signals_json: Json
          channel: string | null
          company_id: string
          confidence: number
          content_hash: string
          conversation_id: string
          created_at: string
          extraction_method: string
          first_message_at: string | null
          first_response_minutes: number | null
          id: string
          intents_json: Json
          last_message_at: string | null
          lead_message_count: number
          lead_source: string | null
          lifecycle_status: string | null
          loss_detected: boolean
          message_count: number
          negative_signals_json: Json
          negotiation_duration_minutes: number | null
          objections_json: Json
          primary_intent: string | null
          products_json: Json
          quality_warnings_json: Json
          quote_detected: boolean
          sale_detected: boolean
          sentiment_label: string | null
          sentiment_score: number | null
          topics_json: Json
          updated_at: string
        }
        Insert: {
          agent_message_count?: number
          analyzed_at?: string
          analyzer_version: string
          buying_signals_json?: Json
          channel?: string | null
          company_id: string
          confidence?: number
          content_hash: string
          conversation_id: string
          created_at?: string
          extraction_method?: string
          first_message_at?: string | null
          first_response_minutes?: number | null
          id?: string
          intents_json?: Json
          last_message_at?: string | null
          lead_message_count?: number
          lead_source?: string | null
          lifecycle_status?: string | null
          loss_detected?: boolean
          message_count?: number
          negative_signals_json?: Json
          negotiation_duration_minutes?: number | null
          objections_json?: Json
          primary_intent?: string | null
          products_json?: Json
          quality_warnings_json?: Json
          quote_detected?: boolean
          sale_detected?: boolean
          sentiment_label?: string | null
          sentiment_score?: number | null
          topics_json?: Json
          updated_at?: string
        }
        Update: {
          agent_message_count?: number
          analyzed_at?: string
          analyzer_version?: string
          buying_signals_json?: Json
          channel?: string | null
          company_id?: string
          confidence?: number
          content_hash?: string
          conversation_id?: string
          created_at?: string
          extraction_method?: string
          first_message_at?: string | null
          first_response_minutes?: number | null
          id?: string
          intents_json?: Json
          last_message_at?: string | null
          lead_message_count?: number
          lead_source?: string | null
          lifecycle_status?: string | null
          loss_detected?: boolean
          message_count?: number
          negative_signals_json?: Json
          negotiation_duration_minutes?: number | null
          objections_json?: Json
          primary_intent?: string | null
          products_json?: Json
          quality_warnings_json?: Json
          quote_detected?: boolean
          sale_detected?: boolean
          sentiment_label?: string | null
          sentiment_score?: number | null
          topics_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_facts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
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
      error_log: {
        Row: {
          company_id: string | null
          context: Json
          created_at: string
          id: string
          message: string
          severity: string
          source: string
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          message: string
          severity?: string
          source: string
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          message?: string
          severity?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      executive_knowledge: {
        Row: {
          company_id: string
          created_at: string
          facts_json: Json
          highlights_json: Json
          id: string
          knowledge_version: number
          period: string
          recommendations_json: Json
          snapshot_generated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          facts_json?: Json
          highlights_json?: Json
          id?: string
          knowledge_version?: number
          period: string
          recommendations_json?: Json
          snapshot_generated_at: string
        }
        Update: {
          company_id?: string
          created_at?: string
          facts_json?: Json
          highlights_json?: Json
          id?: string
          knowledge_version?: number
          period?: string
          recommendations_json?: Json
          snapshot_generated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "executive_knowledge_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      http_audit_log: {
        Row: {
          company_id: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          method: string
          outcome: string | null
          path: string
          status: number | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          method: string
          outcome?: string | null
          path: string
          status?: number | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          method?: string
          outcome?: string | null
          path?: string
          status?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "http_audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          deleted_at: string | null
          deleted_by: string | null
          deleted_for: string | null
          delivery_error_code: string | null
          delivery_error_details: Json | null
          delivery_error_message: string | null
          delivery_status: string | null
          edited_at: string | null
          external_id: string | null
          id: string
          integration_id: string | null
          role: Database["public"]["Enums"]["message_role"]
          source: string | null
          source_metadata: Json
          source_subtype: string | null
          status_updated_at: string | null
          text: string
        }
        Insert: {
          at?: string
          company_id: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_for?: string | null
          delivery_error_code?: string | null
          delivery_error_details?: Json | null
          delivery_error_message?: string | null
          delivery_status?: string | null
          edited_at?: string | null
          external_id?: string | null
          id?: string
          integration_id?: string | null
          role: Database["public"]["Enums"]["message_role"]
          source?: string | null
          source_metadata?: Json
          source_subtype?: string | null
          status_updated_at?: string | null
          text: string
        }
        Update: {
          at?: string
          company_id?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_for?: string | null
          delivery_error_code?: string | null
          delivery_error_details?: Json | null
          delivery_error_message?: string | null
          delivery_status?: string | null
          edited_at?: string | null
          external_id?: string | null
          id?: string
          integration_id?: string | null
          role?: Database["public"]["Enums"]["message_role"]
          source?: string | null
          source_metadata?: Json
          source_subtype?: string | null
          status_updated_at?: string | null
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
          last_seen_at: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          last_seen_at?: string | null
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
      quick_replies: {
        Row: {
          active: boolean
          category: string | null
          company_id: string
          content: string
          created_at: string
          icon: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          company_id: string
          content: string
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          company_id?: string
          content?: string
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
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
      rate_limit_counters: {
        Row: {
          bucket: string
          company_id: string
          count: number
          created_at: string
          id: string
          updated_at: string
          window_seconds: number
          window_start: string
        }
        Insert: {
          bucket: string
          company_id: string
          count?: number
          created_at?: string
          id?: string
          updated_at?: string
          window_seconds: number
          window_start: string
        }
        Update: {
          bucket?: string
          company_id?: string
          count?: number
          created_at?: string
          id?: string
          updated_at?: string
          window_seconds?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limit_counters_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_audit: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          company_id: string | null
          correlation_id: string | null
          created_at: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          company_id?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          company_id?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      runtime_dedupe: {
        Row: {
          bucket: number
          company_id: string | null
          created_at: string
          expires_at: string
          id: string
          operation: string
          resource_key: string
        }
        Insert: {
          bucket: number
          company_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          operation: string
          resource_key: string
        }
        Update: {
          bucket?: number
          company_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          operation?: string
          resource_key?: string
        }
        Relationships: []
      }
      runtime_locks: {
        Row: {
          acquired_at: string
          company_id: string | null
          expires_at: string
          lock_key: string
          owner_id: string
          released_at: string | null
        }
        Insert: {
          acquired_at?: string
          company_id?: string | null
          expires_at: string
          lock_key: string
          owner_id: string
          released_at?: string | null
        }
        Update: {
          acquired_at?: string
          company_id?: string | null
          expires_at?: string
          lock_key?: string
          owner_id?: string
          released_at?: string | null
        }
        Relationships: []
      }
      scientific_hypothesis_registry: {
        Row: {
          category: string
          company_id: string
          confidence: number
          contradiction_count: number
          created_at: string
          description: string | null
          distinct_snapshot_days: number
          first_observed_at: string
          hypothesis_key: string
          id: string
          last_observed_at: string
          last_observed_day: string
          occurrence_count: number
          provenance_key: string
          scientific_score: number
          source_fingerprint: string
          status: string
          supporting_evidence_json: Json
          title: string
          updated_at: string
        }
        Insert: {
          category: string
          company_id: string
          confidence: number
          contradiction_count?: number
          created_at?: string
          description?: string | null
          distinct_snapshot_days?: number
          first_observed_at: string
          hypothesis_key: string
          id?: string
          last_observed_at: string
          last_observed_day: string
          occurrence_count?: number
          provenance_key: string
          scientific_score?: number
          source_fingerprint: string
          status: string
          supporting_evidence_json?: Json
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          company_id?: string
          confidence?: number
          contradiction_count?: number
          created_at?: string
          description?: string | null
          distinct_snapshot_days?: number
          first_observed_at?: string
          hypothesis_key?: string
          id?: string
          last_observed_at?: string
          last_observed_day?: string
          occurrence_count?: number
          provenance_key?: string
          scientific_score?: number
          source_fingerprint?: string
          status?: string
          supporting_evidence_json?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scientific_hypothesis_registry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      scientific_knowledge_registry: {
        Row: {
          category: string
          company_id: string
          confidence: number
          contradiction_count: number
          created_at: string
          distinct_snapshot_days: number
          evidence_summary_json: Json
          id: string
          knowledge_key: string
          last_confirmed_at: string | null
          last_confirmed_day: string | null
          provenance_keys_json: Json
          scientific_score: number
          status: string
          summary: string
          title: string
          updated_at: string
          validated_since: string | null
        }
        Insert: {
          category: string
          company_id: string
          confidence: number
          contradiction_count?: number
          created_at?: string
          distinct_snapshot_days?: number
          evidence_summary_json?: Json
          id?: string
          knowledge_key: string
          last_confirmed_at?: string | null
          last_confirmed_day?: string | null
          provenance_keys_json?: Json
          scientific_score?: number
          status: string
          summary: string
          title: string
          updated_at?: string
          validated_since?: string | null
        }
        Update: {
          category?: string
          company_id?: string
          confidence?: number
          contradiction_count?: number
          created_at?: string
          distinct_snapshot_days?: number
          evidence_summary_json?: Json
          id?: string
          knowledge_key?: string
          last_confirmed_at?: string | null
          last_confirmed_day?: string | null
          provenance_keys_json?: Json
          scientific_score?: number
          status?: string
          summary?: string
          title?: string
          updated_at?: string
          validated_since?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scientific_knowledge_registry_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      scientific_knowledge_snapshots: {
        Row: {
          company_id: string
          created_at: string
          engine_version: string
          evidence_json: Json
          hypotheses_json: Json
          id: string
          observations_json: Json
          period: string
          quality_json: Json
          snapshot_date: string
          snapshot_generated_at: string
          source_fingerprint: string
          theories_json: Json
          validated_knowledge_json: Json
        }
        Insert: {
          company_id: string
          created_at?: string
          engine_version: string
          evidence_json?: Json
          hypotheses_json?: Json
          id?: string
          observations_json?: Json
          period: string
          quality_json?: Json
          snapshot_date: string
          snapshot_generated_at: string
          source_fingerprint: string
          theories_json?: Json
          validated_knowledge_json?: Json
        }
        Update: {
          company_id?: string
          created_at?: string
          engine_version?: string
          evidence_json?: Json
          hypotheses_json?: Json
          id?: string
          observations_json?: Json
          period?: string
          quality_json?: Json
          snapshot_date?: string
          snapshot_generated_at?: string
          source_fingerprint?: string
          theories_json?: Json
          validated_knowledge_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "scientific_knowledge_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      scientific_memory: {
        Row: {
          business_conclusions: Json
          company_id: string
          correlations: Json
          created_at: string
          generated_at: string
          id: string
          knowledge_score: number
          limitations: Json
          memory_date: string
          observed_patterns: Json
          period: string
          quality: Json
          scientific_score: number
          source_fingerprint: string
          strengthening_hypotheses: Json
          validated_theories: Json
          version: string
        }
        Insert: {
          business_conclusions?: Json
          company_id: string
          correlations?: Json
          created_at?: string
          generated_at?: string
          id?: string
          knowledge_score?: number
          limitations?: Json
          memory_date?: string
          observed_patterns?: Json
          period: string
          quality?: Json
          scientific_score?: number
          source_fingerprint?: string
          strengthening_hypotheses?: Json
          validated_theories?: Json
          version: string
        }
        Update: {
          business_conclusions?: Json
          company_id?: string
          correlations?: Json
          created_at?: string
          generated_at?: string
          id?: string
          knowledge_score?: number
          limitations?: Json
          memory_date?: string
          observed_patterns?: Json
          period?: string
          quality?: Json
          scientific_score?: number
          source_fingerprint?: string
          strengthening_hypotheses?: Json
          validated_theories?: Json
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "scientific_memory_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_samples: {
        Row: {
          collected_at: string
          company_id: string | null
          id: string
          metric: string
          tags: Json
          value: number
        }
        Insert: {
          collected_at?: string
          company_id?: string | null
          id?: string
          metric: string
          tags?: Json
          value: number
        }
        Update: {
          collected_at?: string
          company_id?: string | null
          id?: string
          metric?: string
          tags?: Json
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "system_health_samples_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_hashes: {
        Row: {
          bucket: string
          byte_size: number
          company_id: string
          created_at: string
          id: string
          magic_family: string | null
          mime: string | null
          object_path: string
          sha256: string
        }
        Insert: {
          bucket: string
          byte_size: number
          company_id: string
          created_at?: string
          id?: string
          magic_family?: string | null
          mime?: string | null
          object_path: string
          sha256: string
        }
        Update: {
          bucket?: string
          byte_size?: number
          company_id?: string
          created_at?: string
          id?: string
          magic_family?: string | null
          mime?: string | null
          object_path?: string
          sha256?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_hashes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
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
      meta_pages_safe: {
        Row: {
          active: boolean | null
          company_id: string | null
          created_at: string | null
          id: string | null
          ig_business_account_id: string | null
          ig_username: string | null
          integration_id: string | null
          last_error: string | null
          page_id: string | null
          page_name: string | null
          token_expires_at: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          ig_business_account_id?: string | null
          ig_username?: string | null
          integration_id?: string | null
          last_error?: string | null
          page_id?: string | null
          page_name?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          ig_business_account_id?: string | null
          ig_username?: string | null
          integration_id?: string | null
          last_error?: string | null
          page_id?: string | null
          page_name?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ai_agent_maintenance: { Args: never; Returns: undefined }
      check_storage_quota: {
        Args: { _company_id: string; _new_size: number }
        Returns: boolean
      }
      cleanup_executive_knowledge: { Args: never; Returns: number }
      cleanup_scientific_memory: { Args: never; Returns: number }
      cleanup_scientific_snapshots: { Args: never; Returns: number }
      complete_agent_job: {
        Args: {
          _backoff_seconds?: number
          _error?: string
          _job_id: string
          _success: boolean
          _worker_id: string
        }
        Returns: {
          attempts: number
          available_at: string
          company_id: string
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload_json: Json
          priority: number
          started_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "agent_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      count_company_admins: { Args: { _company_id: string }; Returns: number }
      current_company_id: { Args: never; Returns: string }
      dequeue_agent_job: {
        Args: {
          _job_types: string[]
          _lock_seconds?: number
          _worker_id: string
        }
        Returns: {
          attempts: number
          available_at: string
          company_id: string
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload_json: Json
          priority: number
          started_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "agent_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_hook_secret: { Args: { _name: string }; Returns: string }
      get_storage_usage_bytes: {
        Args: { _company_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _company_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      latest_messages_per_conversation: {
        Args: { _company_id: string }
        Returns: {
          at: string
          conversation_id: string
          deleted_at: string
          deleted_for: string
          delivery_status: string
          edited_at: string
          id: string
          role: Database["public"]["Enums"]["message_role"]
          source_metadata: Json
          source_subtype: string
          status_updated_at: string
          text: string
        }[]
      }
      log_audit: {
        Args: {
          _action: string
          _after: Json
          _before: Json
          _company_id: string
          _entity: string
          _entity_id: string
          _user_id: string
        }
        Returns: string
      }
      rate_limit_increment: {
        Args: {
          _bucket: string
          _company_id: string
          _increment?: number
          _window_seconds: number
          _window_start: string
        }
        Returns: number
      }
      runtime_cleanup_expired: {
        Args: never
        Returns: {
          deleted_dedupe: number
          deleted_locks: number
        }[]
      }
      runtime_release_lock: {
        Args: { _lock_key: string; _owner_id: string }
        Returns: boolean
      }
      runtime_try_acquire_lock: {
        Args: {
          _company_id?: string
          _lock_key: string
          _owner_id: string
          _ttl_seconds: number
        }
        Returns: boolean
      }
      runtime_try_dedupe: {
        Args: {
          _bucket: number
          _company_id?: string
          _operation: string
          _resource_key: string
          _ttl_seconds: number
        }
        Returns: boolean
      }
      touch_last_seen: { Args: never; Returns: undefined }
    }
    Enums: {
      ai_proposal_status: "pending" | "approved" | "rejected"
      ai_proposal_type:
        | "faq"
        | "objection"
        | "recurring_reply"
        | "sales_pattern"
      ai_tone: "comercial" | "amigavel" | "premium" | "tecnico" | "informal"
      app_role: "admin" | "atendente" | "financeiro"
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
      onboarding_status: "pending" | "in_progress" | "completed" | "paused"
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
      app_role: ["admin", "atendente", "financeiro"],
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
      onboarding_status: ["pending", "in_progress", "completed", "paused"],
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
