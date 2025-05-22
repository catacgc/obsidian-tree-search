// postcss.config.js
export default {
    plugins: {
      tailwindcss: {
        config: './tailwind.config.js',
      },
      autoprefixer: {},
      'postcss-prefix-selector': {
        prefix: '.tailwind', // The selector for your container
        // Optional: specify which selectors to transform
        transform: function (prefix, selector, prefixedSelector, filePath, rule) {
          // You can exclude global styles like html, body if needed
          if (selector === 'body' || selector === 'html') {
            return selector; // Don't prefix body and html
          }
  
          // For complex selectors, you might need custom logic or ensure
          // Tailwind's base styles are handled as you expect.
          // By default, it will prefix all selectors.
          return prefixedSelector;
        },
      },
    },
  };