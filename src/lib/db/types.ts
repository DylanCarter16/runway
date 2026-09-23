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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_calls: {
        Row: {
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          cost_usd: number | null
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          input_tokens: number | null
          model: string
          ok: boolean
          output_tokens: number | null
          purpose: string
          raw_output: Json | null
          request_ref: string | null
          user_id: string
        }
        Insert: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_tokens?: number | null
          model: string
          ok?: boolean
          output_tokens?: number | null
          purpose: string
          raw_output?: Json | null
          request_ref?: string | null
          user_id: string
        }
        Update: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_tokens?: number | null
          model?: string
          ok?: boolean
          output_tokens?: number | null
          purpose?: string
          raw_output?: Json | null
          request_ref?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ask_messages: {
        Row: {
          citations: Json
          content: string
          created_at: string
          id: string
          model: string | null
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          citations?: Json
          content: string
          created_at?: string
          id?: string
          model?: string | null
          role: string
          thread_id: string
          user_id?: string
        }
        Update: {
          citations?: Json
          content?: string
          created_at?: string
          id?: string
          model?: string | null
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ask_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ask_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_threads: {
        Row: {
          course_id: string | null
          created_at: string
          id: string
          scope: Json
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          id?: string
          scope?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          id?: string
          scope?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ask_threads_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          content: string
          course_id: string | null
          created_at: string
          embedding: string | null
          embedding_model: string | null
          heading: string | null
          id: string
          ord: number
          parent_id: string
          parent_type: string
          search: unknown
          token_estimate: number
          user_id: string
        }
        Insert: {
          content: string
          course_id?: string | null
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          heading?: string | null
          id?: string
          ord: number
          parent_id: string
          parent_type: string
          search?: unknown
          token_estimate?: number
          user_id?: string
        }
        Update: {
          content?: string
          course_id?: string | null
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          heading?: string | null
          id?: string
          ord?: number
          parent_id?: string
          parent_type?: string
          search?: unknown
          token_estimate?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunks_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          ai_allowed: boolean
          ai_policy: string | null
          archived: boolean
          checklist: Json
          code: string
          color: string
          color_dark: string
          created_at: string
          external_ids: Json
          grading_scheme: Json
          id: string
          info_notes: string | null
          late_policy: string | null
          meetings: Json
          office_hours: Json
          outline_url: string | null
          remark_policy: string | null
          site_url: string | null
          slug: string
          sort_order: number
          staff: Json
          submission_platforms: string[]
          term_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_allowed?: boolean
          ai_policy?: string | null
          archived?: boolean
          checklist?: Json
          code: string
          color?: string
          color_dark?: string
          created_at?: string
          external_ids?: Json
          grading_scheme?: Json
          id?: string
          info_notes?: string | null
          late_policy?: string | null
          meetings?: Json
          office_hours?: Json
          outline_url?: string | null
          remark_policy?: string | null
          site_url?: string | null
          slug: string
          sort_order?: number
          staff?: Json
          submission_platforms?: string[]
          term_id: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          ai_allowed?: boolean
          ai_policy?: string | null
          archived?: boolean
          checklist?: Json
          code?: string
          color?: string
          color_dark?: string
          created_at?: string
          external_ids?: Json
          grading_scheme?: Json
          id?: string
          info_notes?: string | null
          late_policy?: string | null
          meetings?: Json
          office_hours?: Json
          outline_url?: string | null
          remark_policy?: string | null
          site_url?: string | null
          slug?: string
          sort_order?: number
          staff?: Json
          submission_platforms?: string[]
          term_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          captured_at: string
          content_hash: string
          course_id: string | null
          created_at: string
          id: string
          kind: string
          meta: Json
          processed_at: string | null
          raw_html: string | null
          raw_text: string
          search: unknown
          source_ref: string | null
          source_url: string | null
          storage_path: string | null
          title: string
          user_id: string
        }
        Insert: {
          captured_at?: string
          content_hash: string
          course_id?: string | null
          created_at?: string
          id?: string
          kind: string
          meta?: Json
          processed_at?: string | null
          raw_html?: string | null
          raw_text: string
          search?: unknown
          source_ref?: string | null
          source_url?: string | null
          storage_path?: string | null
          title: string
          user_id?: string
        }
        Update: {
          captured_at?: string
          content_hash?: string
          course_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          meta?: Json
          processed_at?: string | null
          raw_html?: string | null
          raw_text?: string
          search?: unknown
          source_ref?: string | null
          source_url?: string | null
          storage_path?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          component: string | null
          course_id: string
          created_at: string
          id: string
          item_id: string | null
          label: string
          out_of: number | null
          recorded_at: string
          score: number | null
          source: string
          source_document_id: string | null
          user_id: string
          weight_percent: number | null
        }
        Insert: {
          component?: string | null
          course_id: string
          created_at?: string
          id?: string
          item_id?: string | null
          label: string
          out_of?: number | null
          recorded_at?: string
          score?: number | null
          source?: string
          source_document_id?: string | null
          user_id?: string
          weight_percent?: number | null
        }
        Update: {
          component?: string | null
          course_id?: string
          created_at?: string
          id?: string
          item_id?: string | null
          label?: string
          out_of?: number | null
          recorded_at?: string
          score?: number | null
          source?: string
          source_document_id?: string | null
          user_id?: string
          weight_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "grades_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_tokens: {
        Row: {
          id: string
          meta: Json
          provider: string
          scopes: string[]
          secret_ciphertext: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          meta?: Json
          provider: string
          scopes?: string[]
          secret_ciphertext: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          meta?: Json
          provider?: string
          scopes?: string[]
          secret_ciphertext?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      item_changes: {
        Row: {
          detected_at: string
          field: string
          id: string
          item_id: string
          new_value: string | null
          old_value: string | null
          source: string | null
          user_id: string
        }
        Insert: {
          detected_at?: string
          field: string
          id?: string
          item_id: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
          user_id: string
        }
        Update: {
          detected_at?: string
          field?: string
          id?: string
          item_id?: string
          new_value?: string | null
          old_value?: string | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_changes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          all_day: boolean
          course_id: string | null
          created_at: string
          description: string | null
          due_at: string | null
          ends_at: string | null
          flags: string[]
          gcal_event_id: string | null
          gcal_prep_event_ids: string[]
          gcal_synced_at: string | null
          gcal_synced_hash: string | null
          id: string
          kind: string
          last_change_source: string | null
          location: string | null
          locked_fields: string[]
          prep_days: number | null
          progress: string
          reminder_minutes: number[] | null
          search: unknown
          seat: string | null
          source: string
          source_document_id: string | null
          source_missing_at: string | null
          source_ref: string
          source_url: string | null
          starts_at: string | null
          state: string
          submitted_at: string | null
          time_known: boolean
          title: string
          updated_at: string
          user_id: string
          weight_percent: number | null
        }
        Insert: {
          all_day?: boolean
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          ends_at?: string | null
          flags?: string[]
          gcal_event_id?: string | null
          gcal_prep_event_ids?: string[]
          gcal_synced_at?: string | null
          gcal_synced_hash?: string | null
          id?: string
          kind: string
          last_change_source?: string | null
          location?: string | null
          locked_fields?: string[]
          prep_days?: number | null
          progress?: string
          reminder_minutes?: number[] | null
          search?: unknown
          seat?: string | null
          source: string
          source_document_id?: string | null
          source_missing_at?: string | null
          source_ref?: string
          source_url?: string | null
          starts_at?: string | null
          state?: string
          submitted_at?: string | null
          time_known?: boolean
          title: string
          updated_at?: string
          user_id?: string
          weight_percent?: number | null
        }
        Update: {
          all_day?: boolean
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          ends_at?: string | null
          flags?: string[]
          gcal_event_id?: string | null
          gcal_prep_event_ids?: string[]
          gcal_synced_at?: string | null
          gcal_synced_hash?: string | null
          id?: string
          kind?: string
          last_change_source?: string | null
          location?: string | null
          locked_fields?: string[]
          prep_days?: number | null
          progress?: string
          reminder_minutes?: number[] | null
          search?: unknown
          seat?: string | null
          source?: string
          source_document_id?: string | null
          source_missing_at?: string | null
          source_ref?: string
          source_url?: string | null
          starts_at?: string | null
          state?: string
          submitted_at?: string | null
          time_known?: boolean
          title?: string
          updated_at?: string
          user_id?: string
          weight_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "items_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          run_after: string
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          run_after?: string
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          run_after?: string
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      links: {
        Row: {
          category: string
          course_id: string | null
          created_at: string
          id: string
          label: string
          pinned: boolean
          sort_order: number
          url: string
          user_id: string
          where_to_find: string | null
        }
        Insert: {
          category?: string
          course_id?: string | null
          created_at?: string
          id?: string
          label: string
          pinned?: boolean
          sort_order?: number
          url: string
          user_id?: string
          where_to_find?: string | null
        }
        Update: {
          category?: string
          course_id?: string | null
          created_at?: string
          id?: string
          label?: string
          pinned?: boolean
          sort_order?: number
          url?: string
          user_id?: string
          where_to_find?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "links_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          cleaned_at: string | null
          cleaned_md: string | null
          cleanup_error: string | null
          cleanup_instruction: string | null
          cleanup_model: string | null
          cleanup_status: string
          content_hash: string
          course_id: string | null
          created_at: string
          edited_md: string | null
          id: string
          lecture_on: string | null
          open_questions: string[]
          original_md: string
          search: unknown
          summary: string | null
          title: string | null
          topics: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          cleaned_at?: string | null
          cleaned_md?: string | null
          cleanup_error?: string | null
          cleanup_instruction?: string | null
          cleanup_model?: string | null
          cleanup_status?: string
          content_hash: string
          course_id?: string | null
          created_at?: string
          edited_md?: string | null
          id?: string
          lecture_on?: string | null
          open_questions?: string[]
          original_md: string
          search?: unknown
          summary?: string | null
          title?: string | null
          topics?: string[]
          updated_at?: string
          user_id?: string
        }
        Update: {
          cleaned_at?: string | null
          cleaned_md?: string | null
          cleanup_error?: string | null
          cleanup_instruction?: string | null
          cleanup_model?: string | null
          cleanup_status?: string
          content_hash?: string
          course_id?: string | null
          created_at?: string
          edited_md?: string | null
          id?: string
          lecture_on?: string | null
          open_questions?: string[]
          original_md?: string
          search?: unknown
          summary?: string | null
          title?: string | null
          topics?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          applied_item_id: string | null
          confidence: number | null
          course_id: string | null
          created_at: string
          decided_at: string | null
          evidence: string | null
          id: string
          kind: string
          payload: Json
          source_document_id: string | null
          source_note_id: string | null
          state: string
          target_item_id: string | null
          user_id: string
        }
        Insert: {
          applied_item_id?: string | null
          confidence?: number | null
          course_id?: string | null
          created_at?: string
          decided_at?: string | null
          evidence?: string | null
          id?: string
          kind: string
          payload: Json
          source_document_id?: string | null
          source_note_id?: string | null
          state?: string
          target_item_id?: string | null
          user_id?: string
        }
        Update: {
          applied_item_id?: string | null
          confidence?: number | null
          course_id?: string | null
          created_at?: string
          decided_at?: string | null
          evidence?: string | null
          id?: string
          kind?: string
          payload?: Json
          source_document_id?: string | null
          source_note_id?: string | null
          state?: string
          target_item_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposals_applied_item_id_fkey"
            columns: ["applied_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_source_note_id_fkey"
            columns: ["source_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_target_item_id_fkey"
            columns: ["target_item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          course_id: string | null
          created_at: string
          dedupe_key: string
          done_at: string | null
          gcal_event_id: string | null
          gcal_synced_hash: string | null
          id: string
          item_id: string | null
          kind: string
          paste_kind: string | null
          remind_at: string
          snoozed_until: string | null
          title: string
          url: string | null
          user_id: string
          where_to_find: string | null
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          dedupe_key: string
          done_at?: string | null
          gcal_event_id?: string | null
          gcal_synced_hash?: string | null
          id?: string
          item_id?: string | null
          kind: string
          paste_kind?: string | null
          remind_at: string
          snoozed_until?: string | null
          title: string
          url?: string | null
          user_id?: string
          where_to_find?: string | null
        }
        Update: {
          course_id?: string | null
          created_at?: string
          dedupe_key?: string
          done_at?: string | null
          gcal_event_id?: string | null
          gcal_synced_hash?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          paste_kind?: string | null
          remind_at?: string
          snoozed_until?: string | null
          title?: string
          url?: string | null
          user_id?: string
          where_to_find?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminders_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          answer_style_prompt: string | null
          ask_context_budget: number
          ask_hybrid_search: boolean
          created_at: string
          digest_hour: number
          note_style_prompt: string | null
          piazza_map: Json
          reminder_rules: Json
          study_block_hour: number
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answer_style_prompt?: string | null
          ask_context_budget?: number
          ask_hybrid_search?: boolean
          created_at?: string
          digest_hour?: number
          note_style_prompt?: string | null
          piazza_map?: Json
          reminder_rules?: Json
          study_block_hour?: number
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          answer_style_prompt?: string | null
          ask_context_budget?: number
          ask_hybrid_search?: boolean
          created_at?: string
          digest_hour?: number
          note_style_prompt?: string | null
          piazza_map?: Json
          reminder_rules?: Json
          study_block_hour?: number
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          ok: boolean | null
          source: string
          started_at: string
          stats: Json
          user_id: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          ok?: boolean | null
          source: string
          started_at?: string
          stats?: Json
          user_id: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          ok?: boolean | null
          source?: string
          started_at?: string
          stats?: Json
          user_id?: string
        }
        Relationships: []
      }
      terms: {
        Row: {
          code: string
          created_at: string
          ends_on: string
          id: string
          is_current: boolean
          name: string
          starts_on: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          ends_on: string
          id?: string
          is_current?: boolean
          name: string
          starts_on: string
          user_id?: string
        }
        Update: {
          code?: string
          created_at?: string
          ends_on?: string
          id?: string
          is_current?: boolean
          name?: string
          starts_on?: string
          user_id?: string
        }
        Relationships: []
      }
      watched_pages: {
        Row: {
          cadence: string
          course_id: string | null
          created_at: string
          enabled: boolean
          etag: string | null
          id: string
          label: string
          last_changed_at: string | null
          last_checked_at: string | null
          last_error: string | null
          last_hash: string | null
          last_modified: string | null
          parser: string
          url: string
          user_id: string
        }
        Insert: {
          cadence?: string
          course_id?: string | null
          created_at?: string
          enabled?: boolean
          etag?: string | null
          id?: string
          label: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          last_hash?: string | null
          last_modified?: string | null
          parser?: string
          url: string
          user_id?: string
        }
        Update: {
          cadence?: string
          course_id?: string | null
          created_at?: string
          enabled?: boolean
          etag?: string | null
          id?: string
          label?: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          last_hash?: string | null
          last_modified?: string | null
          parser?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watched_pages_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          dedupe_key: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          run_after: string
          status: string
          type: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      match_chunks: {
        Args: {
          p_course_id?: string
          p_limit?: number
          query_embedding: string
        }
        Returns: {
          chunk_id: string
          content: string
          course_id: string
          heading: string
          parent_id: string
          parent_type: string
          similarity: number
        }[]
      }
      requeue_stale_jobs: { Args: { p_stale?: string }; Returns: number }
      search_all: {
        Args: { p_course_id?: string; p_limit?: number; q: string }
        Returns: {
          course_id: string
          happened_at: string
          rank: number
          result_id: string
          result_type: string
          snippet: string
          title: string
        }[]
      }
      search_chunks: {
        Args: { p_course_id?: string; p_limit?: number; q: string }
        Returns: {
          chunk_id: string
          content: string
          course_id: string
          heading: string
          parent_id: string
          parent_type: string
          rank: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
