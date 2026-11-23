import { DM_Sans, Roboto_Mono, Varela_Round } from 'next/font/google';

const robotoMono = Roboto_Mono({ subsets: ['latin'], variable: '--font-roboto-mono', display: 'swap' });
const dmSans = DM_Sans({
  subsets: ['latin'], variable: '--font-brand-sans', display: 'swap', weight: ['400', '500', '600', '700'],
});
const varelaRound = Varela_Round({
  weight: '400', subsets: ['latin'], variable: '--font-varela-round', display: 'swap',
});

export const fontVariables = `${robotoMono.variable} ${dmSans.variable} ${varelaRound.variable}`;
