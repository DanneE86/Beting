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
      archived_predictions: {
        Row: {
          actual_away_score: number | null
          actual_home_score: number | null
          actual_outcome: string | null
          archived_at: string
          away_id: string
          away_name: string
          away_win_pct: number
          betting_tip: string | null
          brier_score: number | null
          confidence: string
          created_at: string
          draw_pct: number
          event_date: string | null
          event_id: string | null
          home_id: string
          home_name: string
          home_win_pct: number
          id: string
          key_factors: Json | null
          league_id: string
          original_id: string | null
          postmortem: Json | null
          predicted_outcome: string
          predicted_score: string
          resolved_at: string | null
          round: number | null
          season: string
        }
        Insert: {
          actual_away_score?: number | null
          actual_home_score?: number | null
          actual_outcome?: string | null
          archived_at?: string
          away_id: string
          away_name: string
          away_win_pct: number
          betting_tip?: string | null
          brier_score?: number | null
          confidence: string
          created_at?: string
          draw_pct: number
          event_date?: string | null
          event_id?: string | null
          home_id: string
          home_name: string
          home_win_pct: number
          id?: string
          key_factors?: Json | null
          league_id: string
          original_id?: string | null
          postmortem?: Json | null
          predicted_outcome: string
          predicted_score: string
          resolved_at?: string | null
          round?: number | null
          season: string
        }
        Update: {
          actual_away_score?: number | null
          actual_home_score?: number | null
          actual_outcome?: string | null
          archived_at?: string
          away_id?: string
          away_name?: string
          away_win_pct?: number
          betting_tip?: string | null
          brier_score?: number | null
          confidence?: string
          created_at?: string
          draw_pct?: number
          event_date?: string | null
          event_id?: string | null
          home_id?: string
          home_name?: string
          home_win_pct?: number
          id?: string
          key_factors?: Json | null
          league_id?: string
          original_id?: string | null
          postmortem?: Json | null
          predicted_outcome?: string
          predicted_score?: string
          resolved_at?: string | null
          round?: number | null
          season?: string
        }
        Relationships: []
      }
      archived_seasons: {
        Row: {
          away_id: string | null
          away_name: string
          away_score: number | null
          btts: boolean | null
          event_date: string | null
          event_id: string | null
          fetched_at: string
          home_id: string | null
          home_name: string
          home_score: number | null
          id: string
          league_id: string
          outcome: string | null
          raw: Json | null
          round: number | null
          season: string
        }
        Insert: {
          away_id?: string | null
          away_name: string
          away_score?: number | null
          btts?: boolean | null
          event_date?: string | null
          event_id?: string | null
          fetched_at?: string
          home_id?: string | null
          home_name: string
          home_score?: number | null
          id?: string
          league_id: string
          outcome?: string | null
          raw?: Json | null
          round?: number | null
          season: string
        }
        Update: {
          away_id?: string | null
          away_name?: string
          away_score?: number | null
          btts?: boolean | null
          event_date?: string | null
          event_id?: string | null
          fetched_at?: string
          home_id?: string | null
          home_name?: string
          home_score?: number | null
          id?: string
          league_id?: string
          outcome?: string | null
          raw?: Json | null
          round?: number | null
          season?: string
        }
        Relationships: []
      }
      league_prompts: {
        Row: {
          created_at: string
          last_resolved_count: number
          league_id: string
          prompt_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          last_resolved_count?: number
          league_id: string
          prompt_text?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          last_resolved_count?: number
          league_id?: string
          prompt_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      league_season_state: {
        Row: {
          backfilled_at: string | null
          current_season: string
          last_seen_round: number
          league_id: string
          season_started_at: string
          updated_at: string
        }
        Insert: {
          backfilled_at?: string | null
          current_season: string
          last_seen_round?: number
          league_id: string
          season_started_at?: string
          updated_at?: string
        }
        Update: {
          backfilled_at?: string | null
          current_season?: string
          last_seen_round?: number
          league_id?: string
          season_started_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      predictions: {
        Row: {
          actual_away_score: number | null
          actual_home_score: number | null
          actual_outcome: string | null
          away_id: string
          away_name: string
          away_win_pct: number
          betting_tip: string | null
          brier_score: number | null
          confidence: string
          created_at: string
          draw_pct: number
          event_date: string | null
          event_id: string | null
          hidden_from_today_at: string | null
          home_id: string
          home_name: string
          home_win_pct: number
          id: string
          key_factors: Json | null
          league_id: string
          lineup_released: boolean | null
          market_odds_closed_at: string | null
          market_odds_closing: Json | null
          market_odds_last: Json | null
          market_odds_last_seen_at: string | null
          market_odds_open: Json | null
          market_odds_opened_at: string | null
          postmortem: Json | null
          predicted_outcome: string
          predicted_score: string
          resolved_at: string | null
          round: number | null
          btts_call: string | null
          btts_reason: string | null
          model_version: number | null
        }
        Insert: {
          actual_away_score?: number | null
          actual_home_score?: number | null
          actual_outcome?: string | null
          away_id: string
          away_name: string
          away_win_pct: number
          betting_tip?: string | null
          brier_score?: number | null
          confidence: string
          created_at?: string
          draw_pct: number
          event_date?: string | null
          event_id?: string | null
          hidden_from_today_at?: string | null
          home_id: string
          home_name: string
          home_win_pct: number
          id?: string
          key_factors?: Json | null
          league_id: string
          lineup_released?: boolean | null
          market_odds_closed_at?: string | null
          market_odds_closing?: Json | null
          market_odds_last?: Json | null
          market_odds_last_seen_at?: string | null
          market_odds_open?: Json | null
          market_odds_opened_at?: string | null
          postmortem?: Json | null
          predicted_outcome: string
          predicted_score: string
          resolved_at?: string | null
          round?: number | null
          btts_call?: string | null
          btts_reason?: string | null
          model_version?: number | null
        }
        Update: {
          actual_away_score?: number | null
          actual_home_score?: number | null
          actual_outcome?: string | null
          away_id?: string
          away_name?: string
          away_win_pct?: number
          betting_tip?: string | null
          brier_score?: number | null
          confidence?: string
          created_at?: string
          draw_pct?: number
          event_date?: string | null
          event_id?: string | null
          hidden_from_today_at?: string | null
          home_id?: string
          home_name?: string
          home_win_pct?: number
          id?: string
          key_factors?: Json | null
          league_id?: string
          lineup_released?: boolean | null
          market_odds_closed_at?: string | null
          market_odds_closing?: Json | null
          market_odds_last?: Json | null
          market_odds_last_seen_at?: string | null
          market_odds_open?: Json | null
          market_odds_opened_at?: string | null
          postmortem?: Json | null
          predicted_outcome?: string
          predicted_score?: string
          resolved_at?: string | null
          round?: number | null
          btts_call?: string | null
          btts_reason?: string | null
          model_version?: number | null
        }
        Relationships: []
      }
      model_learning_prompts: {
        Row: {
          created_at: string
          last_sample_count: number
          prompt_text: string
          scope: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          last_sample_count?: number
          prompt_text?: string
          scope: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          last_sample_count?: number
          prompt_text?: string
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      trav_learning_prompts: {
        Row: {
          created_at: string
          game_type: string
          last_resolved_count: number
          prompt_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          game_type: string
          last_resolved_count?: number
          prompt_text?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          game_type?: string
          last_resolved_count?: number
          prompt_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      trav_predictions: {
        Row: {
          analysis_model: string | null
          created_at: string
          game_date: string | null
          game_id: string
          game_type: string
          id: string
          learning_prompt: string | null
          legs_json: Json
          meta_json: Json | null
          model_version: number
          payouts_json: Json | null
          postmortem_json: Json | null
          resolved_at: string | null
          result_json: Json | null
          snapshot_json: Json
          status: string
          system_hit_summary: Json | null
          system_json: Json
          winning_numbers_json: Json | null
        }
        Insert: {
          analysis_model?: string | null
          created_at?: string
          game_date?: string | null
          game_id: string
          game_type: string
          id?: string
          learning_prompt?: string | null
          legs_json?: Json
          meta_json?: Json | null
          model_version?: number
          payouts_json?: Json | null
          postmortem_json?: Json | null
          resolved_at?: string | null
          result_json?: Json | null
          snapshot_json?: Json
          status?: string
          system_hit_summary?: Json | null
          system_json?: Json
          winning_numbers_json?: Json | null
        }
        Update: {
          analysis_model?: string | null
          created_at?: string
          game_date?: string | null
          game_id?: string
          game_type?: string
          id?: string
          learning_prompt?: string | null
          legs_json?: Json
          meta_json?: Json | null
          model_version?: number
          payouts_json?: Json | null
          postmortem_json?: Json | null
          resolved_at?: string | null
          result_json?: Json | null
          snapshot_json?: Json
          status?: string
          system_hit_summary?: Json | null
          system_json?: Json
          winning_numbers_json?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
