export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "admin" | "client";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string | null;
          email: string;
          role: UserRole;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          name?: string | null;
          email: string;
          role?: UserRole;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string | null;
          email?: string;
          role?: UserRole;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      hotels: {
        Row: {
          id: string;
          name: string;
          slug: string;
          is_reference_hotel: boolean;
          official_site_enabled: boolean;
          official_site_url: string | null;
          trivago_enabled: boolean;
          trivago_property_id: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          is_reference_hotel?: boolean;
          official_site_enabled?: boolean;
          official_site_url?: string | null;
          trivago_enabled?: boolean;
          trivago_property_id?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          is_reference_hotel?: boolean;
          official_site_enabled?: boolean;
          official_site_url?: string | null;
          trivago_enabled?: boolean;
          trivago_property_id?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Hotel = Database["public"]["Tables"]["hotels"]["Row"];

