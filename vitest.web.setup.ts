import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends Omit<matchers.TestingLibraryMatchers<T, R>, 'toHaveAccessibleName'> {
    toHaveAccessibleName: matchers.TestingLibraryMatchers<T, R>['toHaveAccessibleName'];
  }
}

expect.extend(matchers);
afterEach(() => {
  cleanup();
});
