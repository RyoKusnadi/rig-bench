.PHONY: clean clean-dry-run

# Remove all files/directories ignored by .gitignore
clean:
	git clean -fdX