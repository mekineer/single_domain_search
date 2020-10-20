# cd /Users/User/Documents/GitHub/single_domain_search/
# xhost +
python3.8 -m venv venv --system-site-packages
source venv/bin/activate
# pip install -r requirements.txt
python single_domain_search.py
# deactivate
# rm -rf venv