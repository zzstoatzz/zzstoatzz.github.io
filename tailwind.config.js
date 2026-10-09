module.exports = {
  content: [
    "./src/**/*.{astro,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' }
        },
        glow: {
          '0%, 100%': { 
            boxShadow: '0 0 10px rgb(59 130 246 / 0.4), 0 0 20px rgb(59 130 246 / 0.2), 0 0 30px rgb(59 130 246 / 0.1)',
            backgroundColor: 'rgba(59, 130, 246, 0.01)'
          },
          '50%': { 
            boxShadow: '0 0 15px rgb(59 130 246 / 0.5), 0 0 30px rgb(59 130 246 / 0.3), 0 0 45px rgb(59 130 246 / 0.15)',
            backgroundColor: 'rgba(59, 130, 246, 0.03)'
          }
        },
      },
      animation: {
        'bounce-subtle': 'bounce-subtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    }
  },
  plugins: [],
}
