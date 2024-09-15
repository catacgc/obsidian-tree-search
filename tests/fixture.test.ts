import {createFixture} from "./fixtures";
import {describe, expect, test} from "@jest/globals";

describe('createFixture', () => {
	test("createFixture", () => {
		const fixture = createFixture("test", `
- [[Test]]
	- [[TestChild]]
		- [[TestGrandChild]]
		`)

		expect(fixture.file.lists.values.length).toBe(3)
		expect(fixture.file.lists.values[0].children.length).toBe(1)
		expect(fixture.file.lists.values[0].children[0].children.length).toBe(1)
	})
});
