/**
 * Configuration template for NOT10
 * 
 * SETUP INSTRUCTIONS:
 * 1. Copy this file to config.js
 * 2. Replace the placeholder values with your Supabase credentials
 * 3. Add config.js to .gitignore to keep credentials private
 */

export const config = {
    // Your Supabase project URL
    // Find this in: Supabase Dashboard > Project Settings > API
    supabaseUrl: 'https://your-project.supabase.co',
    
    // Your Supabase anonymous/public key
    // Find this in: Supabase Dashboard > Project Settings > API > anon/public
    supabaseAnonKey: 'your-anon-key-here',
    
    // Optional: Enable debug logging
    debug: false
};

// Export a flag to check if config is properly set
export const isConfigured = () => {
    return config.supabaseUrl !== 'https://your-project.supabase.co' 
        && config.supabaseAnonKey !== 'your-anon-key-here';
};
