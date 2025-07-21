// Professional Defense-Tech Theme Constants
export const theme = {
  // Color Palette
  colors: {
    // Backgrounds
    primary: 'rgba(15, 25, 35, 0.95)',
    secondary: 'rgba(10, 20, 30, 0.8)',
    overlay: 'rgba(0, 0, 0, 0.8)',
    
    // Text
    textPrimary: '#e1e8ed',
    textSecondary: '#a8b8c8',
    textMuted: '#6c7a89',
    
    // Accents
    accent: '#4a90a4',
    accentHover: '#5ba0b4',
    
    // Status Colors (Professional)
    success: '#2d7a3e',    // Dark green
    warning: '#a67c52',    // Dark amber  
    danger: '#a54242',     // Dark red
    info: '#4a90a4',       // Professional blue
    
    // Interactive Elements
    border: '#4a90a4',
    borderMuted: '#3a4a5a',
    track: '#2a3a4a',
    
    // Hover States
    hoverBg: 'rgba(20, 30, 40, 0.95)',
    activeBg: 'rgba(25, 35, 45, 0.95)'
  },
  
  // Typography
  fonts: {
    primary: '"Segoe UI", "Roboto", sans-serif',
    monospace: '"SF Mono", "Monaco", "Roboto Mono", monospace'
  },
  
  // Spacing
  spacing: {
    xs: '4px',
    sm: '6px',
    md: '8px',
    lg: '12px',
    xl: '16px'
  },
  
  // Effects
  shadows: {
    subtle: '0 2px 8px rgba(0,0,0,0.15)',
    medium: '0 4px 16px rgba(0,0,0,0.3)',
    strong: '0 8px 32px rgba(0,0,0,0.5)'
  }
};

// Button Style Variants
export const buttonStyles = {
  primary: {
    backgroundColor: theme.colors.accent,
    color: theme.colors.textPrimary,
    border: `1px solid ${theme.colors.accent}`
  },
  secondary: {
    backgroundColor: theme.colors.secondary,
    color: theme.colors.textPrimary,
    border: `1px solid ${theme.colors.border}`
  },
  success: {
    backgroundColor: theme.colors.success,
    color: theme.colors.textPrimary,
    border: `1px solid ${theme.colors.success}`
  },
  warning: {
    backgroundColor: theme.colors.warning,
    color: theme.colors.textPrimary,
    border: `1px solid ${theme.colors.warning}`
  },
  danger: {
    backgroundColor: theme.colors.danger,
    color: theme.colors.textPrimary,
    border: `1px solid ${theme.colors.danger}`
  },
  info: {
    backgroundColor: theme.colors.info,
    color: theme.colors.textPrimary,
    border: `1px solid ${theme.colors.info}`
  }
};