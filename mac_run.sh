python3.8 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python single_domain_search.py
deactivate
rm -rf venv
