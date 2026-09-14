import './globals.css';

export const metadata = {
  title: 'SENTINEL',
  description: 'SENTINEL · Control de producto próximo a vencer',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#004B93',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
