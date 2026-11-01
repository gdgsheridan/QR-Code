
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_kind": string,"actor_user_id": string | null,"created_at": string,"detail": NonNullable<Json>,"event_id": string | null,"id": number,"subject_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_kind": string,"actor_user_id"?: string | null,"created_at"?: string,"detail"?: NonNullable<Json>,"event_id"?: string | null,"id"?: never,"subject_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_kind"?: string,"actor_user_id"?: string | null,"created_at"?: string,"detail"?: NonNullable<Json>,"event_id"?: string | null,"id"?: never,"subject_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"badges": {
                  Row: {
                    "event_id": string,"linked_at": string,"participant_id": string,"uid": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"linked_at"?: string,"participant_id": string,"uid": string
                  }
                  Update: {
                    "event_id"?: string,"linked_at"?: string,"participant_id"?: string,"uid"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "badges_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "badges_participant_id_event_id_fkey"
      columns: ["participant_id","event_id"]
isOneToOne: false
      referencedRelation: "participants"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"checkpoints": {
                  Row: {
                    "capacity": number | null,"event_id": string,"id": string,"is_open": boolean,"kind": Database["public"]['Enums']["checkpoint_kind"],"name": string,"requires_checkin": boolean,"sort_order": number,"starts_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "capacity"?: number | null,"event_id": string,"id"?: string,"is_open"?: boolean,"kind": Database["public"]['Enums']["checkpoint_kind"],"name": string,"requires_checkin"?: boolean,"sort_order"?: number,"starts_at"?: string | null
                  }
                  Update: {
                    "capacity"?: number | null,"event_id"?: string,"id"?: string,"is_open"?: boolean,"kind"?: Database["public"]['Enums']["checkpoint_kind"],"name"?: string,"requires_checkin"?: boolean,"sort_order"?: number,"starts_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "checkpoints_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"email_outbox": {
                  Row: {
                    "attempts": number,"claim_token": string,"created_at": string,"event_id": string | null,"id": string,"kind": string,"last_error": string | null,"locked_until": string | null,"next_attempt_at": string,"participant_id": string | null,"provider_message_id": string | null,"rate_limit_hits": number,"sent_at": string | null,"status": Database["public"]['Enums']["outbox_status"],"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"claim_token"?: string,"created_at"?: string,"event_id"?: string | null,"id"?: string,"kind": string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"participant_id"?: string | null,"provider_message_id"?: string | null,"rate_limit_hits"?: number,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["outbox_status"],"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"claim_token"?: string,"created_at"?: string,"event_id"?: string | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"locked_until"?: string | null,"next_attempt_at"?: string,"participant_id"?: string | null,"provider_message_id"?: string | null,"rate_limit_hits"?: number,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["outbox_status"],"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_outbox_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_outbox_participant_id_fkey"
      columns: ["participant_id"]
isOneToOne: false
      referencedRelation: "participants"
      referencedColumns: ["id"]
    }
                  ]
                },"event_staff": {
                  Row: {
                    "added_at": string,"event_id": string,"role": Database["public"]['Enums']["staff_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"event_id": string,"role": Database["public"]['Enums']["staff_role"],"user_id": string
                  }
                  Update: {
                    "added_at"?: string,"event_id"?: string,"role"?: Database["public"]['Enums']["staff_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_staff_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "created_at": string,"emergency_info": string,"ends_at": string,"id": string,"name": string,"rsvp_deadline": string | null,"rsvp_reply_by": string | null,"schedule": string,"sheet_id": string | null,"slug": string,"starts_at": string,"teams_open": boolean,"timezone": string,"tracks_released": boolean,"venue": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"emergency_info"?: string,"ends_at": string,"id"?: string,"name": string,"rsvp_deadline"?: string | null,"rsvp_reply_by"?: string | null,"schedule"?: string,"sheet_id"?: string | null,"slug": string,"starts_at": string,"teams_open"?: boolean,"timezone"?: string,"tracks_released"?: boolean,"venue": string
                  }
                  Update: {
                    "created_at"?: string,"emergency_info"?: string,"ends_at"?: string,"id"?: string,"name"?: string,"rsvp_deadline"?: string | null,"rsvp_reply_by"?: string | null,"schedule"?: string,"sheet_id"?: string | null,"slug"?: string,"starts_at"?: string,"teams_open"?: boolean,"timezone"?: string,"tracks_released"?: boolean,"venue"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ingest_seen_requests": {
                  Row: {
                    "request_key": string,"seen_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "request_key": string,"seen_at"?: string
                  }
                  Update: {
                    "request_key"?: string,"seen_at"?: string
                  }
                  Relationships: [

                  ]
                },"participant_tracks": {
                  Row: {
                    "created_at": string,"event_id": string,"participant_id": string,"track_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"participant_id": string,"track_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"participant_id"?: string,"track_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "participant_tracks_participant_id_event_id_fkey"
      columns: ["participant_id","event_id"]
isOneToOne: false
      referencedRelation: "participants"
      referencedColumns: ["id","event_id"]
    },{
      foreignKeyName: "participant_tracks_track_id_event_id_fkey"
      columns: ["track_id","event_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"participants": {
                  Row: {
                    "accessibility": string | null,"allergies": string | null,"allergy_severity": string | null,"bio": string | null,"created_at": string,"deleted_at": string | null,"dietary_notes": string | null,"dietary_set_at": string | null,"directory_opt_in": boolean,"discord_username": string | null,"email": string,"emergency_name": string | null,"emergency_phone": string | null,"emergency_relation": string | null,"event_id": string,"external_id": string | null,"first_name": string,"id": string,"is_test": boolean,"last_name": string,"linkedin_set_at": string | null,"linkedin_url": string | null,"looking_for_team": boolean,"overnight": string | null,"pace": string | null,"photo_path": string | null,"photo_updated_at": string | null,"profile_public": boolean,"rsvp_sent_at": string | null,"rsvp_token_hash": string | null,"search_text": string,"sheet_status": string | null,"source": string,"status": Database["public"]['Enums']["participant_status"],"team_id": string | null,"team_status": string | null,"updated_at": string,"website_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accessibility"?: string | null,"allergies"?: string | null,"allergy_severity"?: string | null,"bio"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"dietary_notes"?: string | null,"dietary_set_at"?: string | null,"directory_opt_in"?: boolean,"discord_username"?: string | null,"email": string,"emergency_name"?: string | null,"emergency_phone"?: string | null,"emergency_relation"?: string | null,"event_id": string,"external_id"?: string | null,"first_name": string,"id"?: string,"is_test"?: boolean,"last_name"?: string,"linkedin_set_at"?: string | null,"linkedin_url"?: string | null,"looking_for_team"?: boolean,"overnight"?: string | null,"pace"?: string | null,"photo_path"?: string | null,"photo_updated_at"?: string | null,"profile_public"?: boolean,"rsvp_sent_at"?: string | null,"rsvp_token_hash"?: string | null,"search_text": string,"sheet_status"?: string | null,"source": string,"status": Database["public"]['Enums']["participant_status"],"team_id"?: string | null,"team_status"?: string | null,"updated_at"?: string,"website_url"?: string | null
                  }
                  Update: {
                    "accessibility"?: string | null,"allergies"?: string | null,"allergy_severity"?: string | null,"bio"?: string | null,"created_at"?: string,"deleted_at"?: string | null,"dietary_notes"?: string | null,"dietary_set_at"?: string | null,"directory_opt_in"?: boolean,"discord_username"?: string | null,"email"?: string,"emergency_name"?: string | null,"emergency_phone"?: string | null,"emergency_relation"?: string | null,"event_id"?: string,"external_id"?: string | null,"first_name"?: string,"id"?: string,"is_test"?: boolean,"last_name"?: string,"linkedin_set_at"?: string | null,"linkedin_url"?: string | null,"looking_for_team"?: boolean,"overnight"?: string | null,"pace"?: string | null,"photo_path"?: string | null,"photo_updated_at"?: string | null,"profile_public"?: boolean,"rsvp_sent_at"?: string | null,"rsvp_token_hash"?: string | null,"search_text"?: string,"sheet_status"?: string | null,"source"?: string,"status"?: Database["public"]['Enums']["participant_status"],"team_id"?: string | null,"team_status"?: string | null,"updated_at"?: string,"website_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "participants_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "participants_team_fk"
      columns: ["team_id","event_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"passes": {
                  Row: {
                    "id": string,"issued_at": string,"participant_id": string,"revoke_reason": string | null,"revoked_at": string | null,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"issued_at"?: string,"participant_id": string,"revoke_reason"?: string | null,"revoked_at"?: string | null,"token_hash": string
                  }
                  Update: {
                    "id"?: string,"issued_at"?: string,"participant_id"?: string,"revoke_reason"?: string | null,"revoked_at"?: string | null,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "passes_participant_id_fkey"
      columns: ["participant_id"]
isOneToOne: false
      referencedRelation: "participants"
      referencedColumns: ["id"]
    }
                  ]
                },"rate_limits": {
                  Row: {
                    "hits": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hits"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "hits"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"reminder_runs": {
                  Row: {
                    "event_id": string,"kind": string,"run_on": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"kind": string,"run_on": string
                  }
                  Update: {
                    "event_id"?: string,"kind"?: string,"run_on"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reminder_runs_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"scan_attempts": {
                  Row: {
                    "checkpoint_id": string | null,"created_at": string,"event_id": string | null,"id": number,"latency_ms": number | null,"participant_id": string | null,"result_code": string,"staff_user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "checkpoint_id"?: string | null,"created_at"?: string,"event_id"?: string | null,"id"?: never,"latency_ms"?: number | null,"participant_id"?: string | null,"result_code": string,"staff_user_id"?: string | null
                  }
                  Update: {
                    "checkpoint_id"?: string | null,"created_at"?: string,"event_id"?: string | null,"id"?: never,"latency_ms"?: number | null,"participant_id"?: string | null,"result_code"?: string,"staff_user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "scan_attempts_checkpoint_id_fkey"
      columns: ["checkpoint_id"]
isOneToOne: false
      referencedRelation: "checkpoints"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scan_attempts_checkpoint_id_fkey"
      columns: ["checkpoint_id"]
isOneToOne: false
      referencedRelation: "v_checkpoint_counts"
      referencedColumns: ["checkpoint_id"]
    },{
      foreignKeyName: "scan_attempts_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"scans": {
                  Row: {
                    "checkpoint_id": string,"client_scan_id": string,"client_scanned_at": string | null,"event_id": string,"id": string,"method": Database["public"]['Enums']["scan_method"],"participant_id": string,"pass_id": string | null,"scanned_at": string,"scanned_by": string,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "checkpoint_id": string,"client_scan_id": string,"client_scanned_at"?: string | null,"event_id": string,"id"?: string,"method": Database["public"]['Enums']["scan_method"],"participant_id": string,"pass_id"?: string | null,"scanned_at"?: string,"scanned_by": string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "checkpoint_id"?: string,"client_scan_id"?: string,"client_scanned_at"?: string | null,"event_id"?: string,"id"?: string,"method"?: Database["public"]['Enums']["scan_method"],"participant_id"?: string,"pass_id"?: string | null,"scanned_at"?: string,"scanned_by"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "scans_checkpoint_id_event_id_fkey"
      columns: ["checkpoint_id","event_id"]
isOneToOne: false
      referencedRelation: "checkpoints"
      referencedColumns: ["id","event_id"]
    },{
      foreignKeyName: "scans_checkpoint_id_event_id_fkey"
      columns: ["checkpoint_id","event_id"]
isOneToOne: false
      referencedRelation: "v_checkpoint_counts"
      referencedColumns: ["checkpoint_id","event_id"]
    },{
      foreignKeyName: "scans_participant_id_event_id_fkey"
      columns: ["participant_id","event_id"]
isOneToOne: false
      referencedRelation: "participants"
      referencedColumns: ["id","event_id"]
    },{
      foreignKeyName: "scans_pass_id_fkey"
      columns: ["pass_id"]
isOneToOne: false
      referencedRelation: "passes"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_invites": {
                  Row: {
                    "email": string,"event_id": string,"role": Database["public"]['Enums']["staff_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "email": string,"event_id": string,"role": Database["public"]['Enums']["staff_role"]
                  }
                  Update: {
                    "email"?: string,"event_id"?: string,"role"?: Database["public"]['Enums']["staff_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "staff_invites_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_profiles": {
                  Row: {
                    "display_name": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "display_name": string,"user_id": string
                  }
                  Update: {
                    "display_name"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"team_invites": {
                  Row: {
                    "created_at": string,"event_id": string,"invited_by": string | null,"participant_id": string,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"invited_by"?: string | null,"participant_id": string,"team_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"invited_by"?: string | null,"participant_id"?: string,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_invites_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "participants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_invites_participant_id_event_id_fkey"
      columns: ["participant_id","event_id"]
isOneToOne: false
      referencedRelation: "participants"
      referencedColumns: ["id","event_id"]
    },{
      foreignKeyName: "team_invites_team_id_event_id_fkey"
      columns: ["team_id","event_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"join_code": string,"name": string,"track_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"join_code": string,"name": string,"track_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"join_code"?: string,"name"?: string,"track_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "teams_track_id_event_id_fkey"
      columns: ["track_id","event_id"]
isOneToOne: false
      referencedRelation: "tracks"
      referencedColumns: ["id","event_id"]
    }
                  ]
                },"tracks": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tracks_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "v_checkpoint_counts": {
                  Row: {
                    "capacity": number | null,"checkpoint_id": string | null,"event_id": string | null,"kind": Database["public"]['Enums']["checkpoint_kind"] | null,"live_scans": number | null,"name": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "checkpoints_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "_prior":
{ Args: { "me": string,"s": Omit<Database["public"]['Tables']["scans"]['Row'], Database["public"]['Tables']["scans"]['ComputedFields']> }; Returns: Json
                           },
"_rsvp_closes":
{ Args: { "p_deadline": string,"p_sent_at": string }; Returns: string
                           },
"_rsvp_undelivered":
{ Args: { "p_participant_id": string }; Returns: boolean
                           },
"_set_hacker_profile":
{ Args: { "p_accessibility"?: string,"p_allergies"?: string,"p_allergy_severity"?: string,"p_bio"?: string,"p_dietary_notes": string,"p_directory_opt_in"?: boolean,"p_discord"?: string,"p_emergency_name": string,"p_emergency_phone": string,"p_emergency_relation": string,"p_linkedin_url": string,"p_overnight"?: string,"p_pace"?: string,"p_participant_id": string,"p_public": boolean,"p_team_status"?: string,"p_website"?: string }; Returns: undefined
                           },
"_who":
{ Args: { "k": Database["public"]['Enums']["checkpoint_kind"],"pa": Omit<Database["public"]['Tables']["participants"]['Row'], Database["public"]['Tables']["participants"]['ComputedFields']> }; Returns: Json
                           },
"add_walk_in":
{ Args: { "p_check_in": boolean,"p_email": string,"p_event_id": string,"p_first_name": string,"p_last_name": string,"p_not_rsvped"?: boolean,"p_organizer_id": string,"p_search_text": string,"p_send_pass": boolean }; Returns: Json
                           },
"admin_participants":
{ Args: { "p_event_id": string,"p_no_show"?: boolean,"p_query"?: string,"p_sheet_status"?: string,"p_status"?: Database["public"]['Enums']["participant_status"] }; Returns: {
              "allergies": string,"allergy_severity": string,"checked_in": boolean,"created_at": string,"dietary_notes": string,"email": string,"external_id": string,"first_name": string,"has_badge": boolean,"id": string,"is_test": boolean,"last_name": string,"live_scans": number,"overnight": string,"pass_state": string,"photo_path": string,"photo_updated_at": string,"rsvp_sent_at": string,"sheet_status": string,"source": string,"status": Database["public"]['Enums']["participant_status"],"team_status": string
            }[]
                           },
"badge_profile":
{ Args: { "p_uid": string,"p_viewer_email"?: string,"p_viewer_id"?: string }; Returns: Json
                           },
"claim_outbox":
{ Args: { "p_limit"?: number }; Returns: {
              "attempts": number,
"claim_token": string,
"created_at": string,
"event_id": string | null,
"id": string,
"kind": string,
"last_error": string | null,
"locked_until": string | null,
"next_attempt_at": string,
"participant_id": string | null,
"provider_message_id": string | null,
"rate_limit_hits": number,
"sent_at": string | null,
"status": Database["public"]['Enums']["outbox_status"],
"user_id": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "email_outbox"
        isOneToOne: false
        isSetofReturn: true
      } },
"consume_staff_invites":
{ Args: { "p_email": string,"p_user_id": string }; Returns: number
                           },
"delete_checkpoint":
{ Args: { "p_actor": string,"p_checkpoint_id": string,"p_event_id": string }; Returns: string
                           },
"delete_participant":
{ Args: { "p_actor": string,"p_event_id": string,"p_participant_id": string }; Returns: Json
                           },
"delete_team":
{ Args: { "p_actor": string,"p_event_id": string,"p_team_id": string }; Returns: string
                           },
"enqueue_pass":
{ Args: { "p_actor": string,"p_event_id": string,"p_participant_id": string }; Returns: string
                           },
"event_metrics":
{ Args: { "p_event_id": string,"p_now"?: string }; Returns: Json
                           },
"finish_outbox":
{ Args: { "p_claim_token"?: string,"p_id": string,"p_last_error"?: string,"p_next_attempt_at"?: string,"p_provider_message_id"?: string,"p_rate_limited"?: boolean,"p_refund"?: boolean,"p_status": Database["public"]['Enums']["outbox_status"] }; Returns: boolean
                           },
"grant_admin_roles":
{ Args: { "p_user_id": string }; Returns: number
                           },
"hacker_directory":
{ Args: { "p_email": string,"p_event_id": string,"p_limit"?: number,"p_looking"?: boolean,"p_pace"?: string,"p_query"?: string,"p_track"?: string }; Returns: Json
                           },
"ingest_sheet_row":
{ Args: { "p_dietary_notes"?: string,"p_dry_run"?: boolean,"p_email": string,"p_event_id": string,"p_external_id": string,"p_first_name": string,"p_last_name": string,"p_linkedin_url"?: string,"p_search_text": string,"p_sheet_status"?: string }; Returns: string
                           },
"invite_staff":
{ Args: { "p_actor": string,"p_email": string,"p_event_id": string,"p_role": Database["public"]['Enums']["staff_role"] }; Returns: string
                           },
"issue_pass":
{ Args: { "p_participant_id": string,"p_pass_id"?: string,"p_token_hash": string }; Returns: string
                           },
"link_badge":
{ Args: { "p_actor": string,"p_event_id": string,"p_move": boolean,"p_participant_id": string,"p_uid": string }; Returns: string
                           },
"pass_lookup":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"password_link_kind":
{ Args: { "p_email": string }; Returns: string
                           },
"queue_rsvps":
{ Args: { "p_actor": string,"p_event_id": string,"p_participant_ids": (string)[] }; Returns: number
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"record_badge_scan":
{ Args: { "p_badge_uid": string,"p_checkpoint_id": string,"p_client_scan_id": string,"p_client_scanned_at": string,"p_staff_user_id": string }; Returns: Json
                           },
"record_ingest_request":
{ Args: { "p_key": string }; Returns: boolean
                           },
"record_scan":
{ Args: { "p_checkpoint_id": string,"p_client_scan_id": string,"p_client_scanned_at": string,"p_method": Database["public"]['Enums']["scan_method"],"p_participant_id": string,"p_staff_user_id": string,"p_token_hash": string }; Returns: Json
                           },
"remove_staff":
{ Args: { "p_actor": string,"p_event_id": string,"p_user_id": string }; Returns: string
                           },
"revoke_pass":
{ Args: { "p_actor": string,"p_event_id": string,"p_participant_id": string }; Returns: string
                           },
"revoke_rsvp":
{ Args: { "p_actor": string,"p_event_id": string,"p_participant_id": string }; Returns: string
                           },
"rsvp_lookup":
{ Args: { "p_token_hash": string }; Returns: Json
                           },
"rsvp_respond":
{ Args: { "p_dietary_notes"?: string,"p_emergency_name"?: string,"p_emergency_phone"?: string,"p_emergency_relation"?: string,"p_going": boolean,"p_linkedin_url"?: string,"p_looking_for_team"?: boolean,"p_public"?: boolean,"p_token_hash": string }; Returns: string
                           },
"run_rsvp_jobs":
{ Args: { "p_now"?: string }; Returns: Json
                           },
"save_badge_profile":
{ Args: { "p_email": string,"p_linkedin_url": string,"p_participant_id": string,"p_public": boolean,"p_user_id": string }; Returns: boolean
                           },
"save_hacker_profile":
{ Args: { "p_accessibility"?: string,"p_allergies"?: string,"p_allergy_severity"?: string,"p_bio"?: string,"p_dietary_notes"?: string,"p_directory_opt_in"?: boolean,"p_discord"?: string,"p_email": string,"p_emergency_name"?: string,"p_emergency_phone"?: string,"p_emergency_relation"?: string,"p_linkedin_url"?: string,"p_overnight"?: string,"p_pace"?: string,"p_participant_id": string,"p_public"?: boolean,"p_team_status"?: string,"p_user_id": string,"p_website"?: string }; Returns: boolean
                           },
"scan_rate_reserve":
{ Args: { "p_not_found_limit": number,"p_per_minute_limit": number,"p_staff_user_id": string }; Returns: Json
                           },
"search_participants":
{ Args: { "p_checkpoint_id"?: string,"p_event_id": string,"p_query": string }; Returns: {
              "email": string,"first_name": string,"id": string,"last_name": string,"photo_path": string,"scanned_here": boolean,"status": Database["public"]['Enums']["participant_status"]
            }[]
                           },
"set_profile_public":
{ Args: { "p_participant_id": string,"p_public": boolean }; Returns: undefined
                           },
"set_rsvp_token":
{ Args: { "p_outbox_id": string,"p_token_hash": string }; Returns: Json
                           },
"set_track_interests":
{ Args: { "p_email": string,"p_participant_id": string,"p_track_ids": (string)[],"p_user_id": string }; Returns: string
                           },
"staff_email_target":
{ Args: { "p_outbox_id": string }; Returns: Json
                           },
"team_create":
{ Args: { "p_code": string,"p_email": string,"p_name": string,"p_participant_id": string,"p_user_id": string }; Returns: string
                           },
"team_invite":
{ Args: { "p_email": string,"p_invitee_id": string,"p_participant_id": string,"p_user_id": string }; Returns: string
                           },
"team_join":
{ Args: { "p_code"?: string,"p_email": string,"p_participant_id": string,"p_team_id"?: string,"p_user_id": string }; Returns: string
                           },
"team_leave":
{ Args: { "p_email": string,"p_participant_id": string,"p_user_id": string }; Returns: string
                           },
"team_set_track":
{ Args: { "p_email": string,"p_participant_id": string,"p_track_id": string,"p_user_id": string }; Returns: string
                           },
"unlink_badge":
{ Args: { "p_actor": string,"p_event_id": string,"p_participant_id": string }; Returns: string
                           },
"void_scan":
{ Args: { "p_reason": string,"p_scan_id": string,"p_staff_user_id": string }; Returns: Json
                           }
          }
          Enums: {
            "checkpoint_kind": "door"|"meal"|"session"|"custom","outbox_status": "pending"|"sending"|"sent"|"failed"|"cancelled","participant_status": "pending"|"accepted"|"waitlisted"|"rejected"|"withdrawn","scan_method": "qr"|"manual"|"nfc","staff_role": "organizer"|"volunteer"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "checkpoint_kind": ["door", "meal", "session", "custom"],"outbox_status": ["pending", "sending", "sent", "failed", "cancelled"],"participant_status": ["pending", "accepted", "waitlisted", "rejected", "withdrawn"],"scan_method": ["qr", "manual", "nfc"],"staff_role": ["organizer", "volunteer"]
          }
        }
} as const
