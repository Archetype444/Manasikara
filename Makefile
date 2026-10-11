.PHONY: init test package

init:
	node --version
	python3 --version

test:
	node --test tests/regression.test.js

package: test
	python3 tools/package.py --chime brass --meditation mudita --finish bowl
