// Public (client-side) Supabase settings extracted from the flowmusic.app web bundle.
import os from "node:os";
import path from "node:path";
export const SUPABASE_URL = "https://ednjccqcmbxeaxbidinr.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmpjY3FjbWJ4ZWF4YmlkaW5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NjEwNjQsImV4cCI6MjA4NzEzNzA2NH0.XCXSuL7Th1xHecfRrP0vAOFmKwJxwBqVFLu06SxtVzg";
export const SITE = "https://www.flowmusic.app";

// Per-user data directory (session, state, dedicated Chrome profile). Override with FLOWMUSIC_HOME.
export const DIR = process.env.FLOWMUSIC_HOME || path.join(os.homedir(), ".config", "gfmusic");
