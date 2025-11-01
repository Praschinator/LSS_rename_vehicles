function isDarkMode() {
       return document.body.classList.contains('dark') || document.body.classList.contains('bigMapDark');
   }
   function getColors() {
       const dark = isDarkMode();
       return dark
           ? {
           bg: 'var(--bs-body-bg, #1e1e1e)',
           text: 'var(--bs-body-color, #eee)',
           border: '#666',
           tableBorder: '#666',
           shadow: '0 6px 20px rgba(0,0,0,0.6)',
           diffPos: '#28a745',
           diffNeg: '#dc3545',
           diffZero: '#ffc107',
       }
       : {
           bg: 'var(--bs-body-bg, #ffffff)',
           text: 'var(--bs-body-color, #111)',
           border: '#ccc',
           tableBorder: '#ccc',
           shadow: '0 6px 20px rgba(0,0,0,0.3)',
           diffPos: '#1a7f1a',
           diffNeg: '#c33',
           diffZero: '#d97706',
       };
   }