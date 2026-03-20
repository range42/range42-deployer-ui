<script setup>
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  category: {
    type: String,
    default: null,
  },
})

// Gradient category color stops
const categoryColors = {
  compute:  { top: '#63b3ed', bottom: '#3182ce' },
  network:  { top: '#68d391', bottom: '#38a169' },
  security: { top: '#f6ad55', bottom: '#dd6b20' },
  action:   { top: '#b794f4', bottom: '#805ad5' },
  service:  { top: '#4fd1c5', bottom: '#319795' },
  ui:       { top: '#a3bffa', bottom: '#667eea' },
  special:  { top: '#f687b3', bottom: '#d53f8c' },
  success:  { top: '#68d391', bottom: '#38a169' },
  error:    { top: '#fc8181', bottom: '#e53e3e' },
  warning:  { top: '#f6e05e', bottom: '#d69e2e' },
}

// Icon registry: each entry has a category and path template string
// Brand icons use category 'brand' and a brandColors object instead of gradient
const icons = {
  // COMPUTE (Blue)
  monitor: {
    category: 'compute',
    path: '<rect x="2" y="3" width="20" height="13" rx="2" fill="url(#icon-grad)"/><rect x="5" y="6" width="14" height="7" rx="1" fill="white" opacity="0.12"/><path d="M8 20h8M12 16v4" stroke="{bottom}" stroke-width="2" stroke-linecap="round"/>',
  },
  cube: {
    category: 'compute',
    path: '<path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16V8z" fill="url(#icon-grad)"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="white" stroke-width="1" opacity="0.25"/>',
  },
  container: {
    category: 'compute',
    path: '<rect x="3" y="5" width="18" height="4" rx="1" fill="url(#icon-grad)"/><rect x="3" y="10" width="18" height="4" rx="1" fill="url(#icon-grad)" opacity="0.75"/><rect x="3" y="15" width="18" height="4" rx="1" fill="url(#icon-grad)" opacity="0.5"/><circle cx="6" cy="7" r="1" fill="white" opacity="0.5"/><circle cx="6" cy="12" r="1" fill="white" opacity="0.5"/><circle cx="6" cy="17" r="1" fill="white" opacity="0.5"/>',
  },
  cpu: {
    category: 'compute',
    path: '<rect x="4" y="4" width="16" height="16" rx="2" fill="url(#icon-grad)"/><rect x="7" y="7" width="10" height="10" rx="1" fill="white" opacity="0.15"/><path d="M4 8h-2M4 12h-2M4 16h-2M20 8h2M20 12h2M20 16h2M8 4v-2M12 4v-2M16 4v-2M8 20v2M12 20v2M16 20v2" stroke="{bottom}" stroke-width="1.5" stroke-linecap="round"/>',
  },

  // NETWORK (Green)
  link: {
    category: 'network',
    path: '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" stroke="{bottom}" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="{top}" stroke-width="2" stroke-linecap="round" fill="none"/>',
  },
  router: {
    category: 'network',
    path: '<circle cx="12" cy="12" r="4" fill="url(#icon-grad)"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="{bottom}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="2" r="1.5" fill="url(#icon-grad)"/><circle cx="12" cy="22" r="1.5" fill="url(#icon-grad)"/><circle cx="2" cy="12" r="1.5" fill="url(#icon-grad)"/><circle cx="22" cy="12" r="1.5" fill="url(#icon-grad)"/>',
  },
  'router-node': {
    category: 'network',
    path: '<path d="M4 12a8 8 0 0114-5.3" stroke="{bottom}" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M20 12a8 8 0 01-14 5.3" stroke="{top}" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M19 4l1 4h-4" fill="url(#icon-grad)"/><path d="M5 20l-1-4h4" fill="url(#icon-grad)"/>',
  },
  switch: {
    category: 'network',
    path: '<rect x="2" y="8" width="20" height="8" rx="2" fill="url(#icon-grad)"/><circle cx="6" cy="12" r="1.5" fill="white" opacity="0.4"/><circle cx="10" cy="12" r="1.5" fill="white" opacity="0.4"/><circle cx="14" cy="12" r="1.5" fill="white" opacity="0.4"/><circle cx="18" cy="12" r="1.5" fill="white" opacity="0.4"/><path d="M6 6v2M10 6v2M14 6v2M18 6v2M6 16v2M10 16v2M14 16v2M18 16v2" stroke="{bottom}" stroke-width="1.5" stroke-linecap="round"/>',
  },
  globe: {
    category: 'network',
    path: '<circle cx="12" cy="12" r="9" fill="url(#icon-grad)"/><ellipse cx="12" cy="12" rx="9" ry="4" fill="none" stroke="white" stroke-width="1" opacity="0.2"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="white" stroke-width="1" opacity="0.2"/>',
  },
  earth: {
    category: 'network',
    path: '<circle cx="12" cy="12" r="9" fill="url(#icon-grad)"/><path d="M3 12h18M5 7h14M5 17h14" stroke="white" stroke-width="0.8" opacity="0.2"/><ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="white" stroke-width="1" opacity="0.25"/>',
  },
  cloud: {
    category: 'network',
    path: '<path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" fill="url(#icon-grad)"/>',
  },
  dns: {
    category: 'network',
    path: '<circle cx="11" cy="11" r="6" fill="url(#icon-grad)" opacity="0.3"/><circle cx="11" cy="11" r="6" stroke="{bottom}" stroke-width="2.5" fill="none"/><path d="M21 21l-4.35-4.35" stroke="{bottom}" stroke-width="2.5" stroke-linecap="round"/>',
  },
  clipboard: {
    category: 'network',
    path: '<path d="M9 2h6v3H9z" fill="url(#icon-grad)" opacity="0.6"/><rect x="5" y="5" width="14" height="16" rx="2" fill="url(#icon-grad)"/><path d="M9 9h6M9 13h4" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.35"/>',
  },
  balance: {
    category: 'network',
    path: '<path d="M12 3v18" stroke="{bottom}" stroke-width="2"/><path d="M4 14l8-3 8 3" stroke="{bottom}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="4" cy="14" r="2.5" fill="url(#icon-grad)"/><circle cx="20" cy="14" r="2.5" fill="url(#icon-grad)"/><circle cx="12" cy="3" r="2.5" fill="url(#icon-grad)"/><path d="M8 21h8" stroke="{bottom}" stroke-width="2" stroke-linecap="round"/>',
  },

  // NETWORK SEGMENTS
  tools: {
    category: 'network',
    path: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.57 6.57a2 2 0 01-2.83-2.83l6.57-6.57A6 6 0 0114.7 6.3z" fill="url(#icon-grad)"/>',
  },
  factory: {
    category: 'network',
    path: '<rect x="2" y="10" width="20" height="10" rx="1" fill="url(#icon-grad)"/><path d="M6 10V7l4-4 4 4v3M14 10V8l4-3v5" stroke="{bottom}" stroke-width="1.5" stroke-linejoin="round" fill="none"/><rect x="5" y="13" width="3" height="3" fill="white" opacity="0.2"/><rect x="10" y="13" width="3" height="3" fill="white" opacity="0.2"/><rect x="16" y="13" width="3" height="3" fill="white" opacity="0.2"/>',
  },
  diamond: {
    category: 'security',
    path: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="url(#icon-grad)" opacity="0.3"/><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="{bottom}" stroke-width="1.5" fill="none"/><path d="M12 8v5M12 15v1.5" stroke="{bottom}" stroke-width="2" stroke-linecap="round"/>',
  },
  users: {
    category: 'network',
    path: '<circle cx="9" cy="7" r="4" fill="url(#icon-grad)"/><path d="M2 21v-2a4 4 0 014-4h6a4 4 0 014 4v2" fill="url(#icon-grad)" opacity="0.6"/><circle cx="17" cy="7" r="3" fill="url(#icon-grad)" opacity="0.5"/><path d="M22 21v-2a3 3 0 00-2.5-2.96" stroke="{bottom}" stroke-width="1.5" stroke-linecap="round" fill="none"/>',
  },
  device: {
    category: 'network',
    path: '<rect x="6" y="3" width="12" height="18" rx="2" fill="url(#icon-grad)"/><rect x="8" y="5" width="8" height="10" rx="1" fill="white" opacity="0.15"/><circle cx="12" cy="18" r="1" fill="white" opacity="0.35"/>',
  },

  // SECURITY (Orange)
  shield: {
    category: 'security',
    path: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="url(#icon-grad)"/>',
  },
  flame: {
    category: 'security',
    path: '<path d="M17.66 11.2C17.43 10.9 14.2 7 12 3c-2.2 4-5.43 7.9-5.66 8.2A5.81 5.81 0 005 14.5C5 18.08 8.13 21 12 21s7-2.92 7-6.5a5.81 5.81 0 00-1.34-3.3z" fill="url(#icon-grad)"/><path d="M12 21c-1.5 0-3-1.5-3-4 0-2.5 3-5 3-5s3 2.5 3 5c0 2.5-1.5 4-3 4z" fill="white" opacity="0.2"/>',
  },
  swords: {
    category: 'security',
    path: '<path d="M14.5 3L6 12h5l-1.5 9L18 12h-5l1.5-9z" fill="url(#icon-grad)"/>',
  },
  castle: {
    category: 'security',
    path: '<path d="M3 10h18v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8z" fill="url(#icon-grad)"/><path d="M6 4h3v6H6zM15 4h3v6h-3z" fill="url(#icon-grad)"/><path d="M10 10V6h4v4" fill="url(#icon-grad)" opacity="0.6"/>',
  },
  lock: {
    category: 'security',
    path: '<rect x="3" y="11" width="18" height="10" rx="2" fill="url(#icon-grad)"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="{bottom}" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="12" cy="16" r="1.5" fill="white" opacity="0.35"/>',
  },
  key: {
    category: 'brand',
    brandColors: { fill: '#008aaa', stroke: '#008aaa' },
    path: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" stroke="{stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="9" cy="15" r="2" fill="{fill}"/>',
  },
  target: {
    category: 'security',
    path: '<circle cx="12" cy="12" r="10" stroke="{bottom}" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="6" stroke="{bottom}" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="2" fill="url(#icon-grad)"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="{bottom}" stroke-width="1.5" stroke-linecap="round"/>',
  },

  // ACTIONS
  rocket: {
    category: 'action',
    path: '<path d="M12 2C9 6 7 10 7 13a5 5 0 0010 0c0-3-2-7-5-11z" fill="url(#icon-grad)"/><path d="M7 13c-2 .5-3 2-3 4h4" fill="url(#icon-grad)" opacity="0.4"/><path d="M17 13c2 .5 3 2 3 4h-4" fill="url(#icon-grad)" opacity="0.4"/><circle cx="12" cy="13" r="2" fill="white" opacity="0.3"/><path d="M10 20l2 2 2-2" stroke="{bottom}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  },
  'check-circle': {
    category: 'success',
    path: '<circle cx="12" cy="12" r="10" fill="url(#icon-grad)"/><path d="M8 12l3 3 5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  'x-circle': {
    category: 'error',
    path: '<circle cx="12" cy="12" r="10" fill="url(#icon-grad)"/><path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2.5" stroke-linecap="round"/>',
  },
  warning: {
    category: 'warning',
    path: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="url(#icon-grad)"/><path d="M12 9v4M12 17h.01" stroke="white" stroke-width="2" stroke-linecap="round"/>',
  },
  pause: {
    category: 'action',
    path: '<rect x="6" y="4" width="4" height="16" rx="1" fill="url(#icon-grad)"/><rect x="14" y="4" width="4" height="16" rx="1" fill="url(#icon-grad)"/>',
  },
  stop: {
    category: 'action',
    path: '<rect x="4" y="4" width="16" height="16" rx="2" fill="url(#icon-grad)"/>',
  },
  play: {
    category: 'action',
    path: '<path d="M5 3l14 9-14 9V3z" fill="url(#icon-grad)"/>',
  },
  skip: {
    category: 'action',
    path: '<path d="M5 4l7 8-7 8V4z" fill="url(#icon-grad)"/><path d="M13 4l7 8-7 8V4z" fill="url(#icon-grad)" opacity="0.6"/>',
  },
  refresh: {
    category: 'action',
    path: '<path d="M23 4v6h-6" stroke="{bottom}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M1 20v-6h6" stroke="{top}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="{bottom}" stroke-width="2" stroke-linecap="round" fill="none"/>',
  },
  trash: {
    category: 'error',
    path: '<path d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" fill="url(#icon-grad)"/><path d="M10 11v6M14 11v6" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.35"/>',
  },
  download: {
    category: 'action',
    path: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="{bottom}" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M7 10l5 5 5-5" stroke="{bottom}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M12 15V3" stroke="{bottom}" stroke-width="2.5" stroke-linecap="round"/>',
  },

  // SERVICES
  books: {
    category: 'service',
    path: '<circle cx="12" cy="5" r="2.5" fill="url(#icon-grad)"/><circle cx="6" cy="19" r="2.5" fill="url(#icon-grad)"/><circle cx="18" cy="19" r="2.5" fill="url(#icon-grad)"/><path d="M12 7.5v4c0 2-2 4-6 6.5M12 11.5c0 2 2 4 6 6.5" stroke="{bottom}" stroke-width="2" stroke-linecap="round" fill="none"/>',
  },
  tea: {
    category: 'brand',
    brandColors: { fill: '#609926', stroke: '#609926' },
    path: '<path d="M5 8h12a1 1 0 011 1v3a6 6 0 01-6 6h-2a6 6 0 01-6-6V9a1 1 0 011-1z" fill="{fill}"/><path d="M18 9h2a2 2 0 010 4h-2" stroke="{stroke}" stroke-width="1.5" fill="none"/><path d="M7 20h8" stroke="{stroke}" stroke-width="1.5" stroke-linecap="round"/><path d="M9 18v2M13 18v2" stroke="{stroke}" stroke-width="1.5" stroke-linecap="round"/><ellipse cx="11" cy="5" rx="4" ry="2" fill="{fill}" opacity="0.3"/>',
  },
  fox: {
    category: 'brand',
    brandColors: { fill: '#E24329', accent1: '#FC6D26', accent2: '#FCA326' },
    path: '<path d="M12 21.35L3.14 14.54l1.74-5.35 2.03-6.24h2.18l-2.03 6.24h9.88l-2.03-6.24h2.18l2.03 6.24 1.74 5.35L12 21.35z" fill="{fill}"/><path d="M12 21.35l4.94-10.16H7.06L12 21.35z" fill="{accent1}"/><path d="M7.06 11.19L3.14 14.54l1.74-5.35 2.18 2z" fill="{accent2}"/><path d="M16.94 11.19l3.92 3.35-1.74-5.35-2.18 2z" fill="{accent2}"/>',
  },
  chat: {
    category: 'brand',
    brandColors: { fill: '#0058CC' },
    path: '<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" fill="{fill}"/>',
  },
  book: {
    category: 'brand',
    brandColors: { fill: '#0288D1' },
    path: '<rect x="4" y="3" width="14" height="4" rx="1" fill="{fill}"/><rect x="4" y="9" width="14" height="4" rx="1" fill="{fill}" opacity="0.75"/><rect x="4" y="15" width="14" height="4" rx="1" fill="{fill}" opacity="0.5"/><path d="M6 5h2M6 11h2M6 17h2" stroke="white" stroke-width="1" stroke-linecap="round" opacity="0.4"/>',
  },
  chart: {
    category: 'service',
    path: '<rect x="3" y="12" width="4" height="9" rx="1" fill="url(#icon-grad)"/><rect x="10" y="6" width="4" height="15" rx="1" fill="url(#icon-grad)" opacity="0.8"/><rect x="17" y="9" width="4" height="12" rx="1" fill="url(#icon-grad)" opacity="0.6"/>',
  },
  trending: {
    category: 'brand',
    brandColors: { fill: '#F46800' },
    path: '<circle cx="12" cy="12" r="8" fill="{fill}"/><circle cx="12" cy="12" r="5" stroke="white" stroke-width="0.5" opacity="0.3" fill="none"/><circle cx="12" cy="12" r="2.5" fill="white" opacity="0.25"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12" stroke="{fill}" stroke-width="1.5" stroke-linecap="round"/>',
  },
  anchor: {
    category: 'brand',
    brandColors: { fill: '#4495D7' },
    path: '<circle cx="12" cy="5" r="3" fill="{fill}"/><path d="M12 8v12" stroke="{fill}" stroke-width="2.5"/><path d="M5 12h14" stroke="{fill}" stroke-width="2.5" stroke-linecap="round"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7" stroke="{fill}" stroke-width="2" stroke-linecap="round" fill="none"/>',
  },
  wrench: {
    category: 'service',
    path: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.57 6.57a2 2 0 01-2.83-2.83l6.57-6.57A6 6 0 0114.7 6.3z" fill="url(#icon-grad)"/>',
  },

  // ORGANIZATION (Indigo)
  folder: {
    category: 'ui',
    path: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z" fill="url(#icon-grad)"/>',
  },
  'folder-open': {
    category: 'ui',
    path: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v0H3V7z" fill="url(#icon-grad)" opacity="0.5"/><path d="M1 10h22v7a3 3 0 01-3 3H4a3 3 0 01-3-3v-7z" fill="url(#icon-grad)"/>',
  },
  gear: {
    category: 'ui',
    path: '<path d="M12 15a3 3 0 100-6 3 3 0 000 6z" fill="url(#icon-grad)"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.18V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 003.09 14H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 0010 3.09V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0020.91 10H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" fill="url(#icon-grad)" opacity="0.5"/>',
  },
  document: {
    category: 'ui',
    path: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="url(#icon-grad)"/><path d="M14 2v6h6" fill="white" opacity="0.15"/>',
  },
  disc: {
    category: 'ui',
    path: '<circle cx="12" cy="12" r="10" fill="url(#icon-grad)"/><circle cx="12" cy="12" r="4" fill="url(#icon-grad)"/><circle cx="12" cy="12" r="4" stroke="white" stroke-width="0.5" opacity="0.3" fill="none"/><circle cx="12" cy="12" r="1.5" fill="white" opacity="0.25"/><path d="M12 2a10 10 0 0110 10" stroke="white" stroke-width="0.8" opacity="0.2" fill="none"/>',
  },
  inbox: {
    category: 'ui',
    path: '<path d="M12 3v10M8 9l4 4 4-4" stroke="{bottom}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="4" y="17" width="16" height="4" rx="1" fill="url(#icon-grad)"/>',
  },
  outbox: {
    category: 'ui',
    path: '<path d="M12 13V3M8 7l4-4 4 4" stroke="{bottom}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><rect x="4" y="17" width="16" height="4" rx="1" fill="url(#icon-grad)"/>',
  },
  compass: {
    category: 'ui',
    path: '<circle cx="12" cy="12" r="10" stroke="{bottom}" stroke-width="2" fill="url(#icon-grad)" opacity="0.15"/><path d="M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z" fill="url(#icon-grad)"/>',
  },
  ruler: {
    category: 'ui',
    path: '<path d="M3 3v18h18" stroke="{bottom}" stroke-width="2" stroke-linecap="round"/><path d="M3 21L9 9l4 6 4-10 4 8" stroke="{top}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  },
  construction: {
    category: 'ui',
    path: '<rect x="3" y="8" width="18" height="12" rx="2" fill="url(#icon-grad)"/><path d="M7 8V5a2 2 0 012-2h6a2 2 0 012 2v3" stroke="{bottom}" stroke-width="2"/>',
  },
  map: {
    category: 'ui',
    path: '<path d="M1 6l8-3 6 3 8-3v15l-8 3-6-3-8 3V6z" fill="url(#icon-grad)"/><path d="M9 3v15M15 6v15" stroke="white" stroke-width="1" opacity="0.2"/>',
  },
  building: {
    category: 'ui',
    path: '<rect x="3" y="3" width="18" height="18" rx="2" fill="url(#icon-grad)"/><path d="M3 9h18M3 15h18" stroke="white" stroke-width="1" opacity="0.15"/><rect x="8" y="15" width="8" height="6" rx="1" fill="white" opacity="0.15"/>',
  },

  // SPECIAL (Pink)
  gamepad: {
    category: 'special',
    path: '<path d="M2 10a4 4 0 014-4h12a4 4 0 014 4v2a4 4 0 01-4 4H6a4 4 0 01-4-4v-2z" fill="url(#icon-grad)"/><circle cx="8" cy="11" r="2" fill="white" opacity="0.3"/><path d="M15 9h3M16.5 7.5v3" stroke="white" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/><path d="M7 16l-1 4M17 16l1 4" stroke="{bottom}" stroke-width="2" stroke-linecap="round"/>',
  },
}

// Generate a unique gradient ID suffix once per instance
const gradId = `grad-${Math.random().toString(36).slice(2, 9)}`

const icon = computed(() => icons[props.name] ?? null)

const effectiveCategory = computed(() => {
  if (props.category) return props.category
  return icon.value?.category ?? 'ui'
})

const colors = computed(() => {
  const cat = effectiveCategory.value
  return categoryColors[cat] ?? categoryColors.ui
})

const isBrand = computed(() => icon.value?.category === 'brand' && !props.category)

// Resolve the path string: replace placeholders with actual values
const resolvedPath = computed(() => {
  if (!icon.value) return ''

  let path = icon.value.path

  if (isBrand.value && icon.value.brandColors) {
    const bc = icon.value.brandColors
    path = path
      .replace(/\{fill\}/g, bc.fill ?? 'currentColor')
      .replace(/\{stroke\}/g, bc.stroke ?? bc.fill ?? 'currentColor')
      .replace(/\{accent1\}/g, bc.accent1 ?? bc.fill ?? 'currentColor')
      .replace(/\{accent2\}/g, bc.accent2 ?? bc.fill ?? 'currentColor')
  } else {
    const { top, bottom } = colors.value
    path = path
      .replace(/\{top\}/g, top)
      .replace(/\{bottom\}/g, bottom)
  }

  // Replace gradient reference placeholder with the unique ID
  path = path.replace(/url\(#icon-grad\)/g, `url(#${gradId})`)

  return path
})

// Warn once for unknown icons (in setup, triggers on prop change too via computed side-effect)
// Use a watcher-like pattern via computed that also triggers the warning
const isKnown = computed(() => {
  if (icons[props.name] === undefined) {
    console.warn(`[AppIcon] Unknown icon name: "${props.name}"`)
    return false
  }
  return true
})
</script>

<template>
  <svg
    v-if="isKnown"
    v-bind="$attrs"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient
        v-if="!isBrand"
        :id="gradId"
        x1="0"
        y1="0"
        x2="0"
        y2="1"
      >
        <stop offset="0%" :stop-color="colors.top" />
        <stop offset="100%" :stop-color="colors.bottom" />
      </linearGradient>
    </defs>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <g v-html="resolvedPath" />
  </svg>
</template>
