from rest_framework import viewsets
from app.models import QueryInfo
from .serializers import *
from django.db.models import Q
from rest_framework.response import Response
from rest_framework import status
from django.http import Http404


class QueryInfoViewSet(viewsets.ModelViewSet):
	serializer_class = QueryInfoSerializer
	# queryset = QueryInfo.objects.all() 

	def get_queryset(self):
		query = self.request.query_params.get('query')
		if query:
			return QueryInfo.objects.filter(Q(query__icontains=query) & Q(mark = 1))
			# serializer = QueryInfoSerializer(queryset, many=True)
			# return Response(serializer.data)
		return QueryInfo.objects.all()

	def create(self, request, *args, **kwargs):
		is_many = isinstance(request.data, list)
		if not is_many:
			return super(QueryInfoViewSet, self).create(request, *args, **kwargs)
		else:
			serializer = self.get_serializer(data=request.data, many=True)
			serializer.is_valid(raise_exception=True)
			self.perform_create(serializer)
			headers = self.get_success_headers(serializer.data)
			return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

	def destroy(self, request, *args, **kwargs):
		try:
			instance = self.get_object()
			self.perform_destroy(instance)
		except Http404:
			pass
		return Response({"msg":"Deleted successfully",
						"status":status.HTTP_200_OK}
						)

	def update(self, request, *args, **kwargs):
		instance = self.get_object()
		serializer = self.get_serializer(instance, data=request.data)
		serializer.is_valid(raise_exception=True)
		self.perform_update(serializer)
		return Response(serializer.data)
