# Test fixtures — NOT secrets

The keys and certificates in this directory are throwaway EC P-256 test
fixtures generated locally (`openssl ecparam`/`openssl req`) for the App Store
JWS verification unit tests. They sign nothing of value and are trusted by
nothing outside these tests: the JWS verifier anchors trust to a configured
root fingerprint, and the tests pass the fingerprint of `test-root.pem`.

Never place real App Store credentials or production certificates here.
