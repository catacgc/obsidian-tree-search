import { getArcTabsStrings } from "../main";

describe('testing main file', () => {
    test('should return all tabs', () => {
      getArcTabsStrings("arctabs.json")
    });
  });