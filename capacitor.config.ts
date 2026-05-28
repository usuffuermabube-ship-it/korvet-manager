import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.korvet.manager',
  appName: 'Korvet Manager',
  webDir: 'client/dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
