import type { ReactElement } from 'react';
import { FreezePage } from './freeze-page';

/** C7 / SEC-INC-003 : interrupteur d'arrêt des flux sortants. */
export default function Gel(): ReactElement {
  return <FreezePage />;
}
