import { clickBtn, exact, initialScenario, themeScenario } from './common'
import type { Scenario } from './types'

const TABS: Array<[id: string, label: string]> = [
  ['checklist', 'Checklist'],
  ['add-ons', 'Add-ons'],
  ['photos', 'Photos'],
  ['messages', 'Messages'],
  ['payments', 'Payments'],
  ['membership', 'Membership'],
  ['history', 'History'],
  ['overview', 'Overview'],
]

export const operationsScenarios: Scenario[] = [
  initialScenario('operations', 'Command Center timeline at the frozen 10:36 AM'),
  {
    id: 'view-tabs',
    screen: 'operations',
    title: 'the four view tabs',
    tags: ['smoke'],
    steps: [
      clickBtn('view-bay-board', 'Bay Board'),
      clickBtn('view-staff', 'Staff'),
      clickBtn('view-calendar', 'Calendar'),
      clickBtn('view-timeline', 'Timeline'),
    ],
  },
  {
    id: 'range-tabs',
    screen: 'operations',
    title: 'the four range tabs',
    steps: [
      clickBtn('range-today', exact('Today')),
      clickBtn('range-tomorrow', 'Tomorrow'),
      clickBtn('range-week', 'Week'),
      clickBtn('range-next-24h', 'Next 24h'),
    ],
  },
  {
    id: 'appointment-file',
    screen: 'operations',
    title: 'open the first appointment file and each of its 8 tabs',
    tags: ['smoke'],
    steps: [
      clickBtn('open-file', 'Marcus Webb', 'open the first appointment card'),
      ...TABS.map(([id, label]) => clickBtn(`tab-${id}`, label, `open the ${label} tab`)),
    ],
  },
  {
    id: 'new-appointment',
    screen: 'operations',
    title: 'open and close the New Appointment panel, then the Walk-in variant',
    steps: [
      clickBtn('open-new', 'New Appointment'),
      clickBtn('cancel-new', exact('Cancel')),
      clickBtn('open-walkin', 'Walk-in'),
    ],
  },
  themeScenario('operations'),
]
